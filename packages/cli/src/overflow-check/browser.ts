import type {
  Browser,
  BrowserType,
  Page,
  Request,
  Response,
} from "playwright-core";
import {
  type BrowserOverflowMeasurement,
  measureDocumentOverflow,
  readDocumentWidthVector,
  type StabilityVector,
  waitForTwoAnimationFrames,
} from "./browser-measure";
import type { OverflowMeasurementInput, OverflowViewport } from "./contracts";
import {
  MAX_OVERFLOW_REPORT_PATH_LENGTH,
  OVERFLOW_VIEWPORTS,
} from "./contracts";
import { OverflowCheckError } from "./error";
import type { ResolvedOverflowPage } from "./options";

const DEFAULT_CHECK_TIMEOUT_MS = 60_000;
const NAVIGATION_TIMEOUT_MS = 15_000;
const HYDRATION_WAIT_MS = 750;
const STABILITY_INTERVAL_MS = 100;
const REQUIRED_STABLE_INTERVALS = 5;
const STABILITY_TIMEOUT_MS = 5000;
const MAX_ELEMENTS = 20_000;
const MAX_CULPRITS = 3;
const MAX_DESCRIPTOR_LENGTH = 160;
const HTML_CONTENT_TYPE_PATTERN =
  /^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i;
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/gu;
const BROWSER_INSTALL_COMMAND =
  "pnpm dlx playwright-core@1.61.1 install chromium";

type OverflowBrowserPage = ResolvedOverflowPage;

interface RunOverflowBrowserCheckOptions {
  browserExecutable?: string;
  origin: string;
  pages: readonly OverflowBrowserPage[];
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface OverflowBrowserMetadata {
  name: string;
  version: string;
}

interface OverflowBrowserCheckResult {
  browser: OverflowBrowserMetadata;
  durationMs: number;
  measurements: OverflowMeasurementInput[];
}

interface LoadedPlaywright {
  chromium: BrowserType;
}

interface OverflowBrowserDependencies {
  loadPlaywright: () => Promise<LoadedPlaywright>;
  now: () => number;
  wait: (durationMs: number) => Promise<void>;
}

interface LaunchedBrowser {
  browser: Browser;
  name: string;
}

interface BrowserLaunchAttempt {
  channel?: "chrome" | "msedge";
  executablePath?: string;
  name: string;
}

interface MeasurementContext {
  deadline: number;
  dependencies: OverflowBrowserDependencies;
  origin: string;
  signal?: AbortSignal;
}

const defaultDependencies: OverflowBrowserDependencies = {
  loadPlaywright: async () => import("playwright-core"),
  now: Date.now,
  wait: (durationMs) =>
    new Promise((resolve) => {
      setTimeout(resolve, durationMs);
    }),
};

const createCheckError = (
  code:
    | "OVERFLOW_BROWSER_UNAVAILABLE"
    | "OVERFLOW_TARGET_UNAVAILABLE"
    | "OVERFLOW_CHECK_TIMEOUT"
    | "OVERFLOW_PAGE_NOT_STABLE"
    | "OVERFLOW_CHECK_FAILED",
  message: string
): OverflowCheckError => new OverflowCheckError(code, message);

const throwIfInterrupted = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted) {
    throw createCheckError(
      "OVERFLOW_CHECK_FAILED",
      "The horizontal overflow check was interrupted."
    );
  }
};

const remainingTime = (
  deadline: number,
  dependencies: OverflowBrowserDependencies
): number => Math.max(0, deadline - dependencies.now());

const throwIfTimedOut = (
  deadline: number,
  dependencies: OverflowBrowserDependencies
): void => {
  if (remainingTime(deadline, dependencies) <= 0) {
    throw createCheckError(
      "OVERFLOW_CHECK_TIMEOUT",
      "The horizontal overflow check exceeded its 60 second deadline."
    );
  }
};

const runBeforeDeadline = async <Result>(
  operation: Promise<Result>,
  context: Pick<MeasurementContext, "deadline" | "dependencies" | "signal">,
  timeoutMessage = "The horizontal overflow check exceeded its 60 second deadline."
): Promise<Result> => {
  const { deadline, dependencies, signal } = context;
  throwIfInterrupted(signal);
  throwIfTimedOut(deadline, dependencies);

  return await new Promise<Result>((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        reject(createCheckError("OVERFLOW_CHECK_TIMEOUT", timeoutMessage));
      },
      remainingTime(deadline, dependencies)
    );
    const onAbort = (): void => {
      reject(
        createCheckError(
          "OVERFLOW_CHECK_FAILED",
          "The horizontal overflow check was interrupted."
        )
      );
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (result) => {
        cleanup();
        resolve(result);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      }
    );
  });
};

const sanitizeReportPath = (url: string): string => {
  try {
    return new URL(url).pathname
      .replace(CONTROL_CHARACTER_PATTERN, "")
      .slice(0, MAX_OVERFLOW_REPORT_PATH_LENGTH);
  } catch {
    return "/";
  }
};

const sanitizeDisplayPath = (path: string): string =>
  path
    .replace(CONTROL_CHARACTER_PATTERN, "")
    .slice(0, MAX_OVERFLOW_REPORT_PATH_LENGTH);

const isSameOrigin = (url: string, expectedOrigin: string): boolean => {
  try {
    const parsedUrl = new URL(url);
    const isHttpPage =
      parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
    return (
      isHttpPage &&
      parsedUrl.username === "" &&
      parsedUrl.password === "" &&
      parsedUrl.origin === expectedOrigin
    );
  } catch {
    return false;
  }
};

const isSuccessfulHtmlResponse = (response: Response): boolean => {
  const status = response.status();
  const contentType = response.headers()["content-type"] ?? "";
  return (
    status >= 200 && status < 300 && HTML_CONTENT_TYPE_PATTERN.test(contentType)
  );
};

const hasOnlySameOriginRedirects = (
  response: Response,
  expectedOrigin: string
): boolean => {
  let request: Request | null = response.request();

  while (request) {
    if (!isSameOrigin(request.url(), expectedOrigin)) {
      return false;
    }
    request = request.redirectedFrom();
  }

  return true;
};

const vectorsMatch = (
  first: StabilityVector,
  second: StabilityVector
): boolean =>
  first[0] === second[0] && first[1] === second[1] && first[2] === second[2];

const waitForStableDocumentWidth = async (
  page: Page,
  context: MeasurementContext
): Promise<void> => {
  const { deadline, dependencies, signal } = context;
  const stabilityDeadline = Math.min(
    deadline,
    dependencies.now() + STABILITY_TIMEOUT_MS
  );
  let previousVector = await runBeforeDeadline(
    page.evaluate(readDocumentWidthVector),
    context
  );
  let stableIntervals = 0;

  while (dependencies.now() < stabilityDeadline) {
    throwIfInterrupted(signal);
    const waitDuration = Math.min(
      STABILITY_INTERVAL_MS,
      stabilityDeadline - dependencies.now()
    );
    await runBeforeDeadline(dependencies.wait(waitDuration), context);
    const currentVector = await runBeforeDeadline(
      page.evaluate(readDocumentWidthVector),
      context
    );

    stableIntervals = vectorsMatch(previousVector, currentVector)
      ? stableIntervals + 1
      : 0;
    if (stableIntervals >= REQUIRED_STABLE_INTERVALS) {
      return;
    }
    previousVector = currentVector;
  }

  throwIfTimedOut(deadline, dependencies);
  throw createCheckError(
    "OVERFLOW_PAGE_NOT_STABLE",
    "The page width did not settle within 5 seconds."
  );
};

const waitForPageReadiness = async (
  page: Page,
  context: MeasurementContext
): Promise<void> => {
  await runBeforeDeadline(page.evaluate("document.fonts.ready"), context);
  await runBeforeDeadline(
    context.dependencies.wait(HYDRATION_WAIT_MS),
    context
  );
  await waitForStableDocumentWidth(page, context);
  await runBeforeDeadline(page.evaluate(waitForTwoAnimationFrames), context);
};

const toMeasurementInput = ({
  browserMeasurement,
  finalPath,
  httpStatus,
  reportPath,
  viewport,
}: {
  browserMeasurement: BrowserOverflowMeasurement;
  finalPath: string;
  httpStatus: number;
  reportPath: string;
  viewport: OverflowViewport;
}): OverflowMeasurementInput => ({
  clientWidth: browserMeasurement.clientWidth,
  culprits: browserMeasurement.culprits,
  finalPath,
  forcedScrollbar: browserMeasurement.forcedScrollbar,
  httpStatus,
  omittedCulprits: browserMeasurement.omittedCulprits,
  page: reportPath,
  scrollWidth: browserMeasurement.scrollWidth,
  viewport,
});

const navigateAndMeasure = async ({
  browser,
  context,
  page: targetPage,
  viewport,
}: {
  browser: Browser;
  context: MeasurementContext;
  page: OverflowBrowserPage;
  viewport: OverflowViewport;
}): Promise<OverflowMeasurementInput> => {
  const browserContext = await runBeforeDeadline(
    browser.newContext({
      acceptDownloads: false,
      colorScheme: "light",
      deviceScaleFactor: 1,
      serviceWorkers: "block",
      viewport: { height: viewport.height, width: viewport.width },
    }),
    context
  );
  const unexpectedPageClosures: Promise<unknown>[] = [];

  try {
    const page = await runBeforeDeadline(browserContext.newPage(), context);
    const displayPath = sanitizeDisplayPath(targetPage.displayPath);
    let crossOriginMainNavigation = false;
    let latestMainFrameResponse: Response | null = null;
    await runBeforeDeadline(
      page.route("**/*", async (route) => {
        const request = route.request();
        if (
          request.isNavigationRequest() &&
          request.frame() === page.mainFrame() &&
          !isSameOrigin(request.url(), context.origin)
        ) {
          crossOriginMainNavigation = true;
          await route.abort("blockedbyclient");
          return;
        }

        await route.continue();
      }),
      context
    );
    page.on("response", (observedResponse) => {
      const request = observedResponse.request();
      if (
        request.isNavigationRequest() &&
        request.frame() === page.mainFrame()
      ) {
        latestMainFrameResponse = observedResponse;
      }
    });
    browserContext.on("page", (openedPage) => {
      if (openedPage !== page) {
        unexpectedPageClosures.push(openedPage.close().catch(() => undefined));
      }
    });
    const throwIfCrossOriginNavigation = (): void => {
      if (
        crossOriginMainNavigation ||
        !isSameOrigin(page.url(), context.origin)
      ) {
        throw createCheckError(
          "OVERFLOW_TARGET_UNAVAILABLE",
          `The target page ${displayPath} attempted a cross-origin navigation.`
        );
      }
    };
    const getValidatedMainFrameResponse = (): Response => {
      throwIfCrossOriginNavigation();
      const settledResponse = latestMainFrameResponse;
      const responseIsValid =
        settledResponse !== null &&
        isSuccessfulHtmlResponse(settledResponse) &&
        hasOnlySameOriginRedirects(settledResponse, context.origin);
      if (!responseIsValid) {
        throw createCheckError(
          "OVERFLOW_TARGET_UNAVAILABLE",
          `The target page ${displayPath} did not return same-origin HTML with a successful status.`
        );
      }
      return settledResponse;
    };
    const navigationTimeout = Math.min(
      NAVIGATION_TIMEOUT_MS,
      remainingTime(context.deadline, context.dependencies)
    );
    let response: Response | null;

    try {
      response = await page.goto(targetPage.requestedUrl, {
        timeout: navigationTimeout,
        waitUntil: "load",
      });
    } catch (error) {
      throwIfInterrupted(context.signal);
      throwIfTimedOut(context.deadline, context.dependencies);
      throwIfCrossOriginNavigation();
      if (error instanceof Error && error.name === "TimeoutError") {
        throw createCheckError(
          "OVERFLOW_CHECK_TIMEOUT",
          `The target page ${displayPath} did not load within 15 seconds.`
        );
      }
      throw createCheckError(
        "OVERFLOW_TARGET_UNAVAILABLE",
        `The target page ${displayPath} could not be loaded.`
      );
    }

    if (latestMainFrameResponse === null) {
      latestMainFrameResponse = response;
    }
    getValidatedMainFrameResponse();

    await waitForPageReadiness(page, context);
    getValidatedMainFrameResponse();
    let browserMeasurement: BrowserOverflowMeasurement;
    try {
      browserMeasurement = await runBeforeDeadline(
        page.evaluate(measureDocumentOverflow, {
          maxCulprits: MAX_CULPRITS,
          maxDescriptorLength: MAX_DESCRIPTOR_LENGTH,
          maxElements: MAX_ELEMENTS,
        }),
        context
      );
    } catch (error) {
      throwIfCrossOriginNavigation();
      throw error;
    }
    const finalResponse = getValidatedMainFrameResponse();

    return toMeasurementInput({
      browserMeasurement,
      finalPath: sanitizeReportPath(page.url()),
      httpStatus: finalResponse.status(),
      reportPath: targetPage.displayPath,
      viewport,
    });
  } finally {
    await Promise.allSettled(unexpectedPageClosures);
    await browserContext.close().catch(() => undefined);
  }
};

const createLaunchAttempts = (
  browserExecutable: string | undefined
): BrowserLaunchAttempt[] => {
  if (browserExecutable) {
    return [{ executablePath: browserExecutable, name: "chromium" }];
  }

  return [
    { name: "chromium" },
    { channel: "chrome", name: "chrome" },
    { channel: "msedge", name: "msedge" },
  ];
};

const launchBrowser = async (
  chromium: BrowserType,
  browserExecutable: string | undefined,
  context: MeasurementContext
): Promise<LaunchedBrowser> => {
  for (const attempt of createLaunchAttempts(browserExecutable)) {
    throwIfInterrupted(context.signal);
    throwIfTimedOut(context.deadline, context.dependencies);

    try {
      const browser = await chromium.launch({
        channel: attempt.channel,
        executablePath: attempt.executablePath,
        headless: true,
        timeout: Math.min(
          NAVIGATION_TIMEOUT_MS,
          remainingTime(context.deadline, context.dependencies)
        ),
      });
      if (context.signal?.aborted) {
        await browser.close().catch(() => undefined);
        throwIfInterrupted(context.signal);
      }
      return { browser, name: attempt.name };
    } catch (error) {
      if (error instanceof OverflowCheckError) {
        throw error;
      }
    }
  }

  throw createCheckError(
    "OVERFLOW_BROWSER_UNAVAILABLE",
    `No supported Chromium browser is available. Install one with: ${BROWSER_INSTALL_COMMAND}`
  );
};

const runOverflowBrowserCheck = async (
  {
    browserExecutable,
    origin,
    pages,
    signal,
    timeoutMs = DEFAULT_CHECK_TIMEOUT_MS,
  }: RunOverflowBrowserCheckOptions,
  dependencies: OverflowBrowserDependencies = defaultDependencies
): Promise<OverflowBrowserCheckResult> => {
  const startedAt = dependencies.now();
  const deadline = startedAt + timeoutMs;
  const context: MeasurementContext = {
    deadline,
    dependencies,
    origin,
    signal,
  };
  let playwright: LoadedPlaywright;

  try {
    playwright = await runBeforeDeadline(
      dependencies.loadPlaywright(),
      context
    );
  } catch (error) {
    if (error instanceof OverflowCheckError) {
      throw error;
    }
    throw createCheckError(
      "OVERFLOW_BROWSER_UNAVAILABLE",
      `The Chromium runtime could not be loaded. Install it with: ${BROWSER_INSTALL_COMMAND}`
    );
  }

  const launchedBrowser = await launchBrowser(
    playwright.chromium,
    browserExecutable,
    context
  );

  try {
    try {
      const measurements: OverflowMeasurementInput[] = [];

      for (const targetPage of pages) {
        throwIfInterrupted(signal);
        throwIfTimedOut(deadline, dependencies);
        const settledMeasurements = await Promise.allSettled(
          OVERFLOW_VIEWPORTS.map((viewport) =>
            navigateAndMeasure({
              browser: launchedBrowser.browser,
              context,
              page: targetPage,
              viewport,
            })
          )
        );
        const rejectedMeasurement = settledMeasurements.find(
          (result) => result.status === "rejected"
        );

        if (rejectedMeasurement?.status === "rejected") {
          throw rejectedMeasurement.reason;
        }

        for (const result of settledMeasurements) {
          if (result.status === "fulfilled") {
            measurements.push(result.value);
          }
        }
      }

      return {
        browser: {
          name: launchedBrowser.name,
          version: launchedBrowser.browser.version(),
        },
        durationMs: Math.max(0, dependencies.now() - startedAt),
        measurements,
      };
    } catch (error) {
      if (error instanceof OverflowCheckError) {
        throw error;
      }
      throw createCheckError(
        "OVERFLOW_CHECK_FAILED",
        "The browser could not complete the horizontal overflow check."
      );
    }
  } finally {
    await launchedBrowser.browser.close().catch(() => undefined);
  }
};

export type {
  OverflowBrowserCheckResult,
  OverflowBrowserDependencies,
  OverflowBrowserMetadata,
  OverflowBrowserPage,
  RunOverflowBrowserCheckOptions,
};
export { runOverflowBrowserCheck, sanitizeReportPath };
