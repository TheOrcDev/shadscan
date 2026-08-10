const OVERFLOW_CHECK_ERROR_CODES = [
  "INVALID_ARGUMENTS",
  "OVERFLOW_BROWSER_UNAVAILABLE",
  "OVERFLOW_TARGET_UNAVAILABLE",
  "OVERFLOW_CHECK_TIMEOUT",
  "OVERFLOW_PAGE_NOT_STABLE",
  "OVERFLOW_CHECK_FAILED",
] as const;

type OverflowCheckErrorCode = (typeof OVERFLOW_CHECK_ERROR_CODES)[number];

class OverflowCheckError extends Error {
  readonly code: OverflowCheckErrorCode;

  constructor(code: OverflowCheckErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "OverflowCheckError";
  }
}

export type { OverflowCheckErrorCode };
export { OVERFLOW_CHECK_ERROR_CODES, OverflowCheckError };
