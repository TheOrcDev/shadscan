import { compareCodeUnits } from "../deterministic-order";
import { sanitizeTerminalText } from "../render-human";
import {
  MAX_CULPRIT_DESCRIPTOR_LENGTH,
  MAX_OVERFLOW_CULPRITS,
  OVERFLOW_CHECK_KIND,
  OVERFLOW_CHECK_SCHEMA_VERSION,
  OVERFLOW_CHECK_SEVERITY,
  OVERFLOW_ENGINE_VERSION,
  OVERFLOW_REMEDIATION,
  OVERFLOW_VIEWPORTS,
  type OverflowCheckReport,
  OverflowCheckReportSchema,
  type OverflowCulprit,
  type OverflowCulpritCandidate,
  type OverflowMeasurement,
  type OverflowMeasurementInput,
  type OverflowTarget,
} from "./contracts";
import { OverflowCheckError } from "./error";

interface EvaluateOverflowCheckOptions {
  durationMs: number;
  measurements: OverflowMeasurementInput[];
  target: OverflowTarget;
}

const throwInvalidMeasurement = (): never => {
  throw new OverflowCheckError(
    "OVERFLOW_CHECK_FAILED",
    "The browser returned an invalid horizontal overflow measurement."
  );
};

const sanitizeDescriptor = (descriptor: string): string => {
  const sanitized = sanitizeTerminalText(descriptor)
    .replaceAll(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_CULPRIT_DESCRIPTOR_LENGTH);

  return sanitized === "" ? "unknown element" : sanitized;
};

const compareCulprits = (
  left: OverflowCulpritCandidate,
  right: OverflowCulpritCandidate
): number =>
  right.overflowPx - left.overflowPx ||
  right.depth - left.depth ||
  left.order - right.order ||
  compareCodeUnits(left.descriptor, right.descriptor);

const normalizeOverflowCulprits = (
  candidates: OverflowCulpritCandidate[]
): OverflowCulprit[] =>
  [...candidates]
    .sort(compareCulprits)
    .slice(0, MAX_OVERFLOW_CULPRITS)
    .map(({ descriptor, left, overflowPx, right }) => ({
      descriptor: sanitizeDescriptor(descriptor),
      left,
      overflowPx: Math.max(0, overflowPx),
      right,
    }));

const createOverflowMeasurement = (
  input: OverflowMeasurementInput
): OverflowMeasurement => {
  const overflowPx = Math.max(0, input.scrollWidth - input.clientWidth);
  const status =
    overflowPx > 0 || input.forcedScrollbar
      ? ("fail" as const)
      : ("pass" as const);
  const candidates = status === "fail" ? (input.culprits ?? []) : [];
  const omittedByCore = Math.max(0, candidates.length - MAX_OVERFLOW_CULPRITS);

  return {
    clientWidth: input.clientWidth,
    culprits: normalizeOverflowCulprits(candidates),
    finalPath: input.finalPath,
    forcedScrollbar: input.forcedScrollbar,
    httpStatus: input.httpStatus,
    omittedCulprits:
      status === "fail"
        ? Math.max(input.omittedCulprits ?? 0, omittedByCore)
        : 0,
    overflowPx,
    page: input.page,
    scrollWidth: input.scrollWidth,
    status,
    viewport: input.viewport,
  };
};

const validateMeasurementMatrix = (
  target: OverflowTarget,
  measurements: OverflowMeasurementInput[]
): void => {
  const expectedMeasurementCount =
    target.pages.length * OVERFLOW_VIEWPORTS.length;
  if (measurements.length !== expectedMeasurementCount) {
    throwInvalidMeasurement();
  }

  for (const [pageIndex, page] of target.pages.entries()) {
    for (const [viewportIndex, viewport] of OVERFLOW_VIEWPORTS.entries()) {
      const measurementIndex =
        pageIndex * OVERFLOW_VIEWPORTS.length + viewportIndex;
      const measurement = measurements[measurementIndex];
      if (!measurement) {
        throwInvalidMeasurement();
      }

      if (
        measurement.page !== page ||
        measurement.viewport.name !== viewport.name ||
        measurement.viewport.width !== viewport.width ||
        measurement.viewport.height !== viewport.height
      ) {
        throwInvalidMeasurement();
      }
    }
  }
};

const evaluateOverflowCheck = ({
  durationMs,
  measurements,
  target,
}: EvaluateOverflowCheckOptions): OverflowCheckReport => {
  validateMeasurementMatrix(target, measurements);
  const results = measurements.map(createOverflowMeasurement);
  const failed = results.filter((result) => result.status === "fail").length;
  const maximumOverflowPx = Math.max(
    ...results.map((result) => result.overflowPx)
  );
  const status = failed > 0 ? ("fail" as const) : ("pass" as const);

  const parsedReport = OverflowCheckReportSchema.safeParse({
    durationMs,
    engineVersion: OVERFLOW_ENGINE_VERSION,
    kind: OVERFLOW_CHECK_KIND,
    remediation: status === "fail" ? OVERFLOW_REMEDIATION : null,
    results,
    schemaVersion: OVERFLOW_CHECK_SCHEMA_VERSION,
    severity: OVERFLOW_CHECK_SEVERITY,
    status,
    summary: {
      failed,
      maximumOverflowPx,
      measurements: results.length,
    },
    target,
    viewports: OVERFLOW_VIEWPORTS,
  });

  if (!parsedReport.success) {
    return throwInvalidMeasurement();
  }

  return parsedReport.data;
};

export type { EvaluateOverflowCheckOptions };
export {
  createOverflowMeasurement,
  evaluateOverflowCheck,
  normalizeOverflowCulprits,
  sanitizeDescriptor,
};
