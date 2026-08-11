import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  BrowserType,
  CDPSession,
  Page,
  Response,
} from "playwright-core";
import { describe, expect, it, vi } from "vitest";
import {
  type OverflowBrowserDependencies,
  runOverflowBrowserCheck,
  sanitizeReportPath,
} from "../src/overflow-check/browser";

const TARGET_ORIGIN = "http://127.0.0.1:4173";

interface BrowserFixture {
  abortRequest: ReturnType<typeof vi.fn>;
  browser: Browser;
  closeBrowser: ReturnType<typeof vi.fn>;
  closeContexts: ReturnType<typeof vi.fn>[];
  dependencies: OverflowBrowserDependencies;
  launch: ReturnType<typeof vi.fn>;
  newContext: ReturnType<typeof vi.fn>;
}

interface MockRequestPausedEvent {
  frameId: string;
  redirectedRequestId?: string;
  request: { url: string };
  requestId: string;
  resourceType: "Document";
}

const createBrowserFixture = ({
  crossOriginNavigation = false,
  failManagedLaunch = false,
  failMeasurement = false,
}: {
  crossOriginNavigation?: boolean;
  failManagedLaunch?: boolean;
  failMeasurement?: boolean;
} = {}): BrowserFixture => {
  const closeBrowser = vi.fn(() => Promise.resolve(undefined));
  const closeContexts: ReturnType<typeof vi.fn>[] = [];
  const abortRequest = vi.fn((_parameters?: unknown) =>
    Promise.resolve(undefined)
  );

  const newContext = vi.fn((options: BrowserContextOptions) => {
    const clientWidth = options.viewport?.width ?? 0;
    const closeContext = vi.fn(() => Promise.resolve(undefined));
    const mainFrame = {};
    const mainFrameId = "main-frame";
    let currentUrl = `${TARGET_ORIGIN}/`;
    let requestPausedHandler:
      | ((event: MockRequestPausedEvent) => void)
      | undefined;
    const sendCdpCommand = vi.fn(
      (method: string, parameters?: { requestId?: string }) => {
        if (method === "Page.getFrameTree") {
          return Promise.resolve({ frameTree: { frame: { id: mainFrameId } } });
        }
        if (method === "Fetch.failRequest") {
          return abortRequest(parameters);
        }
        return Promise.resolve({});
      }
    );
    const cdpSession = {
      on: vi.fn(
        (event: string, handler: (request: MockRequestPausedEvent) => void) => {
          if (event === "Fetch.requestPaused") {
            requestPausedHandler = handler;
          }
        }
      ),
      send: sendCdpCommand,
    } as unknown as CDPSession;
    const response = {
      headers: () => ({ "content-type": "text/html; charset=utf-8" }),
      request: () => ({
        redirectedFrom: () => null,
        url: () => currentUrl,
      }),
      status: () => 200,
    } as unknown as Response;
    closeContexts.push(closeContext);
    const page = {
      evaluate: vi.fn((pageFunction: unknown) => {
        if (typeof pageFunction === "string") {
          return Promise.resolve(undefined);
        }

        const functionName =
          typeof pageFunction === "function" ? pageFunction.name : "";
        if (functionName === "readDocumentWidthVector") {
          return Promise.resolve([clientWidth, clientWidth, clientWidth]);
        }
        if (functionName === "waitForTwoAnimationFrames") {
          return Promise.resolve(undefined);
        }
        if (failMeasurement) {
          return Promise.reject(new Error("private browser detail"));
        }

        return Promise.resolve({
          clientWidth,
          culprits: [],
          forcedScrollbar: false,
          omittedCulprits: 0,
          scrollWidth: clientWidth,
        });
      }),
      goto: vi.fn((requestedUrl: string) => {
        currentUrl = requestedUrl;
        requestPausedHandler?.({
          frameId: mainFrameId,
          request: { url: requestedUrl },
          requestId: "initial-navigation",
          resourceType: "Document",
        });
        if (crossOriginNavigation) {
          requestPausedHandler?.({
            frameId: mainFrameId,
            request: { url: "https://external.example/private" },
            requestId: "client-navigation",
            resourceType: "Document",
          });
        }
        return Promise.resolve(response);
      }),
      mainFrame: () => mainFrame,
      on: vi.fn(),
      url: () => currentUrl,
    } as unknown as Page;
    const browserContext = {
      close: closeContext,
      newCDPSession: vi.fn(() => Promise.resolve(cdpSession)),
      newPage: vi.fn(() => Promise.resolve(page)),
      on: vi.fn(),
    } as unknown as BrowserContext;
    return Promise.resolve(browserContext);
  });
  const browser = {
    close: closeBrowser,
    newContext,
    version: () => "123.0.0.0",
  } as unknown as Browser;
  const launch = vi.fn(
    (options: { channel?: string; executablePath?: string }) => {
      if (failManagedLaunch && !options.channel && !options.executablePath) {
        return Promise.reject(new Error("managed browser missing"));
      }
      return Promise.resolve(browser);
    }
  );
  const chromium = { launch } as unknown as BrowserType;

  return {
    abortRequest,
    browser,
    closeBrowser,
    closeContexts,
    dependencies: {
      loadPlaywright: () => Promise.resolve({ chromium }),
      now: () => 1000,
      wait: () => Promise.resolve(undefined),
    },
    launch,
    newContext,
  };
};

describe("runOverflowBrowserCheck", () => {
  it("falls back to stable Chrome and cleans every isolated context", async () => {
    const fixture = createBrowserFixture({ failManagedLaunch: true });

    const result = await runOverflowBrowserCheck(
      {
        origin: TARGET_ORIGIN,
        pages: [
          {
            displayPath: "/fits?[redacted]#[redacted]",
            requestedUrl: `${TARGET_ORIGIN}/fits?token=private#account`,
          },
        ],
      },
      fixture.dependencies
    );

    expect(fixture.launch).toHaveBeenCalledTimes(2);
    expect(fixture.launch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ channel: "chrome", headless: true })
    );
    expect(result.browser).toEqual({ name: "chrome", version: "123.0.0.0" });
    expect(
      result.measurements.map((measurement) => measurement.viewport)
    ).toEqual([
      { height: 820, name: "mobile", width: 320 },
      { height: 1000, name: "desktop", width: 1440 },
    ]);
    expect(result.measurements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          finalPath: "/fits",
          page: "/fits?[redacted]#[redacted]",
        }),
      ])
    );
    expect(fixture.newContext).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptDownloads: false,
        colorScheme: "light",
        deviceScaleFactor: 1,
        serviceWorkers: "block",
      })
    );
    expect(fixture.closeContexts).toHaveLength(2);
    expect(
      fixture.closeContexts.every((close) => close.mock.calls.length === 1)
    ).toBe(true);
    expect(fixture.closeBrowser).toHaveBeenCalledOnce();
  });

  it("uses only the explicit executable when one is provided", async () => {
    const fixture = createBrowserFixture();

    await runOverflowBrowserCheck(
      {
        browserExecutable: "/opt/chromium",
        origin: TARGET_ORIGIN,
        pages: [{ displayPath: "/", requestedUrl: `${TARGET_ORIGIN}/` }],
      },
      fixture.dependencies
    );

    expect(fixture.launch).toHaveBeenCalledOnce();
    expect(fixture.launch).toHaveBeenCalledWith(
      expect.objectContaining({ executablePath: "/opt/chromium" })
    );
  });

  it("normalizes unexpected page failures and still closes the browser", async () => {
    const fixture = createBrowserFixture({ failMeasurement: true });

    await expect(
      runOverflowBrowserCheck(
        {
          origin: TARGET_ORIGIN,
          pages: [{ displayPath: "/", requestedUrl: `${TARGET_ORIGIN}/` }],
        },
        fixture.dependencies
      )
    ).rejects.toMatchObject({
      code: "OVERFLOW_CHECK_FAILED",
      message: "The browser could not complete the horizontal overflow check.",
    });
    expect(fixture.closeBrowser).toHaveBeenCalledOnce();
    expect(fixture.closeContexts).toHaveLength(2);
    expect(
      fixture.closeContexts.every((close) => close.mock.calls.length === 1)
    ).toBe(true);
  });

  it("blocks cross-origin top-level navigation before measurement", async () => {
    const fixture = createBrowserFixture({ crossOriginNavigation: true });

    await expect(
      runOverflowBrowserCheck(
        {
          origin: TARGET_ORIGIN,
          pages: [{ displayPath: "/", requestedUrl: `${TARGET_ORIGIN}/` }],
        },
        fixture.dependencies
      )
    ).rejects.toMatchObject({
      code: "OVERFLOW_TARGET_UNAVAILABLE",
      message: "The target page / attempted a cross-origin navigation.",
    });
    expect(fixture.abortRequest).toHaveBeenCalledTimes(2);
    expect(fixture.closeBrowser).toHaveBeenCalledOnce();
  });
});

describe("sanitizeReportPath", () => {
  it("removes query and fragment secrets", () => {
    expect(
      sanitizeReportPath(`${TARGET_ORIGIN}/settings?token=private#account`)
    ).toBe("/settings");
  });

  it("uses a safe fallback for malformed browser URLs", () => {
    expect(sanitizeReportPath("not a URL")).toBe("/");
  });
});
