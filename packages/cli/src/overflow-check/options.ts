import {
  MAX_OVERFLOW_PAGES,
  MAX_OVERFLOW_REPORT_PATH_LENGTH,
  MAX_OVERFLOW_URL_LENGTH,
} from "./contracts";
import { OverflowCheckError } from "./error";

const ABSOLUTE_URL_PATTERN = /^[a-z][a-z\d+.-]*:/i;

interface ResolveOverflowCheckTargetOptions {
  routes?: string[];
  target: string;
}

interface ResolvedOverflowPage {
  displayPath: string;
  requestedUrl: string;
}

interface ResolvedOverflowCheckTarget {
  origin: string;
  pages: ResolvedOverflowPage[];
}

const invalidArguments = (message: string): never => {
  throw new OverflowCheckError("INVALID_ARGUMENTS", message);
};

const hasUnsafeInput = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    );
  });

const ensureSafeLength = (
  value: string,
  label: string,
  maximumLength = MAX_OVERFLOW_URL_LENGTH
): void => {
  if (value.length > maximumLength) {
    invalidArguments(`${label} must be at most ${maximumLength} characters.`);
  }

  if (hasUnsafeInput(value)) {
    invalidArguments(`${label} cannot contain control characters.`);
  }
};

const parseTargetUrl = (value: string): URL => {
  ensureSafeLength(value, "The overflow target URL");
  const target = value.trim();

  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return invalidArguments(
      "The overflow target must be an absolute HTTP or HTTPS URL."
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    invalidArguments(
      "The overflow target must be an absolute HTTP or HTTPS URL."
    );
  }

  if (url.username !== "" || url.password !== "") {
    invalidArguments("The overflow target URL cannot include credentials.");
  }

  ensureSafeLength(url.href, "The overflow target URL");
  return url;
};

const toOverflowDisplayPath = (url: URL): string => {
  const queryMarker = url.search === "" ? "" : "?[redacted]";
  const hashMarker = url.hash === "" ? "" : "#[redacted]";
  const suffix = `${queryMarker}${hashMarker}`;
  return `${url.pathname.slice(0, MAX_OVERFLOW_REPORT_PATH_LENGTH - suffix.length)}${suffix}`;
};

const parseRouteUrl = (value: string, origin: string): URL => {
  ensureSafeLength(value, "Each overflow route");
  const route = value.trim();
  if (route === "") {
    return invalidArguments("Overflow routes cannot be empty.");
  }

  if (
    ABSOLUTE_URL_PATTERN.test(route) ||
    !route.startsWith("/") ||
    route.startsWith("//") ||
    route.includes("\\") ||
    route.includes("?") ||
    route.includes("#")
  ) {
    return invalidArguments(
      "Overflow routes must start with one slash and cannot contain a query, hash, or backslash."
    );
  }

  let url: URL;
  try {
    url = new URL(route, `${origin}/`);
  } catch {
    return invalidArguments(
      "Each overflow route must be a valid relative URL."
    );
  }

  if (url.origin !== origin) {
    return invalidArguments(
      "Overflow routes must be same-origin relative paths."
    );
  }

  ensureSafeLength(url.href, "Each overflow route");
  return url;
};

const resolveOverflowCheckTarget = ({
  routes = [],
  target,
}: ResolveOverflowCheckTargetOptions): ResolvedOverflowCheckTarget => {
  const targetUrl = parseTargetUrl(target);
  const uniqueUrls = new Map<string, URL>([[targetUrl.href, targetUrl]]);

  for (const route of routes) {
    const url = parseRouteUrl(route, targetUrl.origin);
    uniqueUrls.set(url.href, url);

    if (uniqueUrls.size > MAX_OVERFLOW_PAGES) {
      return invalidArguments(
        `Overflow checks support at most ${MAX_OVERFLOW_PAGES} unique pages.`
      );
    }
  }

  const pages = [...uniqueUrls.values()].map((url) => ({
    displayPath: toOverflowDisplayPath(url),
    requestedUrl: url.href,
  }));
  if (
    new Set(pages.map(({ displayPath }) => displayPath)).size !== pages.length
  ) {
    return invalidArguments(
      "Overflow page paths must remain unique within the report length limit."
    );
  }

  return {
    origin: targetUrl.origin,
    pages,
  };
};

export type {
  ResolvedOverflowCheckTarget,
  ResolvedOverflowPage,
  ResolveOverflowCheckTargetOptions,
};
export { resolveOverflowCheckTarget, toOverflowDisplayPath };
