import { z } from "zod";
import packageJson from "../../package.json";

const OVERFLOW_CHECK_SCHEMA_VERSION = 1 as const;
const OVERFLOW_CHECK_KIND = "overflow-check" as const;
const OVERFLOW_CHECK_SEVERITY = "critical" as const;
const OVERFLOW_ENGINE_VERSION = packageJson.version;
const MAX_OVERFLOW_PAGES = 10;
const MAX_OVERFLOW_RESULTS = MAX_OVERFLOW_PAGES * 2;
const MAX_OVERFLOW_CULPRITS = 3;
const MAX_OVERFLOW_URL_LENGTH = 2048;
const MAX_OVERFLOW_REPORT_PATH_LENGTH = 1024;
const MAX_CULPRIT_DESCRIPTOR_LENGTH = 160;
const MAX_MEASUREMENT_VALUE = 100_000_000;
const MAX_DURATION_MS = 300_000;
const OVERFLOW_REMEDIATION =
  "Fix document-level overflow by constraining wide content, adding min-width: 0 to shrinking flex or grid children, wrapping long values, or using a bounded local scroller. Do not hide overflow on html or body; fix the element that expands the document.";

const OVERFLOW_VIEWPORTS = [
  { height: 820, name: "mobile", width: 320 },
  { height: 1000, name: "desktop", width: 1440 },
] as const;

const MobileViewportSchema = z.object({
  height: z.literal(820),
  name: z.literal("mobile"),
  width: z.literal(320),
});

const DesktopViewportSchema = z.object({
  height: z.literal(1000),
  name: z.literal("desktop"),
  width: z.literal(1440),
});

const OverflowViewportSchema = z.discriminatedUnion("name", [
  MobileViewportSchema,
  DesktopViewportSchema,
]);

const BoundedMeasurementSchema = z
  .number()
  .finite()
  .min(-MAX_MEASUREMENT_VALUE)
  .max(MAX_MEASUREMENT_VALUE);

const NonNegativeMeasurementSchema = BoundedMeasurementSchema.nonnegative();
const ReportPathSchema = z
  .string()
  .min(1)
  .max(MAX_OVERFLOW_REPORT_PATH_LENGTH)
  .startsWith("/");
const OverflowOriginSchema = z
  .string()
  .url()
  .max(MAX_OVERFLOW_URL_LENGTH)
  .refine((origin) => {
    try {
      const url = new URL(origin);
      return (
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.username === "" &&
        url.password === "" &&
        url.origin === origin
      );
    } catch {
      return false;
    }
  }, "Expected an HTTP or HTTPS origin without credentials.");

const OverflowCulpritSchema = z.object({
  descriptor: z.string().min(1).max(MAX_CULPRIT_DESCRIPTOR_LENGTH),
  left: BoundedMeasurementSchema,
  overflowPx: NonNegativeMeasurementSchema,
  right: BoundedMeasurementSchema,
});

const OverflowMeasurementSchema = z
  .object({
    clientWidth: NonNegativeMeasurementSchema.int(),
    culprits: z.array(OverflowCulpritSchema).max(MAX_OVERFLOW_CULPRITS),
    finalPath: ReportPathSchema,
    forcedScrollbar: z.boolean(),
    httpStatus: z.number().int().min(100).max(599),
    omittedCulprits: z.number().int().nonnegative().max(20_000),
    overflowPx: NonNegativeMeasurementSchema.int(),
    page: ReportPathSchema,
    scrollWidth: NonNegativeMeasurementSchema.int(),
    status: z.enum(["fail", "pass"]),
    viewport: OverflowViewportSchema,
  })
  .superRefine((measurement, context) => {
    const expectedOverflow = Math.max(
      0,
      measurement.scrollWidth - measurement.clientWidth
    );
    const expectedStatus =
      expectedOverflow > 0 || measurement.forcedScrollbar ? "fail" : "pass";

    if (measurement.overflowPx !== expectedOverflow) {
      context.addIssue({
        code: "custom",
        message: "overflowPx must match scrollWidth - clientWidth.",
        path: ["overflowPx"],
      });
    }

    if (measurement.status !== expectedStatus) {
      context.addIssue({
        code: "custom",
        message: "status must reflect document overflow.",
        path: ["status"],
      });
    }

    if (measurement.status === "pass" && measurement.culprits.length > 0) {
      context.addIssue({
        code: "custom",
        message: "Passing measurements cannot contain culprits.",
        path: ["culprits"],
      });
    }
  });

const OverflowTargetSchema = z
  .object({
    origin: OverflowOriginSchema,
    pages: z.array(ReportPathSchema).min(1).max(MAX_OVERFLOW_PAGES),
  })
  .superRefine((target, context) => {
    if (new Set(target.pages).size !== target.pages.length) {
      context.addIssue({
        code: "custom",
        message: "Target pages must be unique.",
        path: ["pages"],
      });
    }
  });

const OverflowSummarySchema = z.object({
  failed: z.number().int().nonnegative().max(MAX_OVERFLOW_RESULTS),
  maximumOverflowPx: NonNegativeMeasurementSchema.int(),
  measurements: z.number().int().min(1).max(MAX_OVERFLOW_RESULTS),
});

const OverflowCheckReportSchema = z
  .object({
    durationMs: z.number().finite().nonnegative().max(MAX_DURATION_MS),
    engineVersion: z.string().min(1).max(64),
    kind: z.literal(OVERFLOW_CHECK_KIND),
    remediation: z.string().min(1).max(500).nullable(),
    results: z
      .array(OverflowMeasurementSchema)
      .min(1)
      .max(MAX_OVERFLOW_RESULTS),
    schemaVersion: z.literal(OVERFLOW_CHECK_SCHEMA_VERSION),
    severity: z.literal(OVERFLOW_CHECK_SEVERITY),
    status: z.enum(["fail", "pass"]),
    summary: OverflowSummarySchema,
    target: OverflowTargetSchema,
    viewports: z.tuple([MobileViewportSchema, DesktopViewportSchema]),
  })
  .superRefine((report, context) => {
    const failed = report.results.filter(
      (measurement) => measurement.status === "fail"
    ).length;
    const maximumOverflowPx = Math.max(
      ...report.results.map((measurement) => measurement.overflowPx)
    );
    const expectedStatus = failed > 0 ? "fail" : "pass";

    if (report.summary.measurements !== report.results.length) {
      context.addIssue({
        code: "custom",
        message: "summary.measurements must match the result count.",
        path: ["summary", "measurements"],
      });
    }

    if (report.summary.failed !== failed) {
      context.addIssue({
        code: "custom",
        message: "summary.failed must match the failed result count.",
        path: ["summary", "failed"],
      });
    }

    if (report.summary.maximumOverflowPx !== maximumOverflowPx) {
      context.addIssue({
        code: "custom",
        message: "summary.maximumOverflowPx must match the results.",
        path: ["summary", "maximumOverflowPx"],
      });
    }

    if (report.status !== expectedStatus) {
      context.addIssue({
        code: "custom",
        message: "status must reflect failed measurements.",
        path: ["status"],
      });
    }

    if (
      (report.status === "pass" && report.remediation !== null) ||
      (report.status === "fail" && report.remediation === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "remediation must be present only for failed reports.",
        path: ["remediation"],
      });
    }

    const expectedMeasurementCount =
      report.target.pages.length * OVERFLOW_VIEWPORTS.length;
    const matrixIsComplete =
      report.results.length === expectedMeasurementCount &&
      report.target.pages.every((page, pageIndex) =>
        OVERFLOW_VIEWPORTS.every((viewport, viewportIndex) => {
          const resultIndex =
            pageIndex * OVERFLOW_VIEWPORTS.length + viewportIndex;
          const result = report.results[resultIndex];
          return (
            result?.page === page &&
            result.viewport.name === viewport.name &&
            result.viewport.width === viewport.width &&
            result.viewport.height === viewport.height
          );
        })
      );

    if (!matrixIsComplete) {
      context.addIssue({
        code: "custom",
        message:
          "Results must contain mobile and desktop measurements per page.",
        path: ["results"],
      });
    }
  });

type OverflowViewport = z.infer<typeof OverflowViewportSchema>;
type OverflowCulprit = z.infer<typeof OverflowCulpritSchema>;
type OverflowMeasurement = z.infer<typeof OverflowMeasurementSchema>;
type OverflowCheckReport = z.infer<typeof OverflowCheckReportSchema>;
type OverflowTarget = z.infer<typeof OverflowTargetSchema>;

interface OverflowCulpritCandidate extends OverflowCulprit {
  depth: number;
  order: number;
}

interface OverflowMeasurementInput {
  clientWidth: number;
  culprits?: OverflowCulpritCandidate[];
  finalPath: string;
  forcedScrollbar: boolean;
  httpStatus: number;
  omittedCulprits?: number;
  page: string;
  scrollWidth: number;
  viewport: OverflowViewport;
}

export type {
  OverflowCheckReport,
  OverflowCulprit,
  OverflowCulpritCandidate,
  OverflowMeasurement,
  OverflowMeasurementInput,
  OverflowTarget,
  OverflowViewport,
};
export {
  MAX_CULPRIT_DESCRIPTOR_LENGTH,
  MAX_OVERFLOW_CULPRITS,
  MAX_OVERFLOW_PAGES,
  MAX_OVERFLOW_REPORT_PATH_LENGTH,
  MAX_OVERFLOW_URL_LENGTH,
  OVERFLOW_CHECK_KIND,
  OVERFLOW_CHECK_SCHEMA_VERSION,
  OVERFLOW_CHECK_SEVERITY,
  OVERFLOW_ENGINE_VERSION,
  OVERFLOW_REMEDIATION,
  OVERFLOW_VIEWPORTS,
  OverflowCheckReportSchema,
  OverflowCulpritSchema,
  OverflowMeasurementSchema,
  OverflowTargetSchema,
  OverflowViewportSchema,
};
