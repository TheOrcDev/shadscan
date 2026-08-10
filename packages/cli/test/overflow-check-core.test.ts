import { describe, expect, it } from "vitest";
import type {
  OverflowCheckReport,
  OverflowCulpritCandidate,
  OverflowMeasurementInput,
} from "../src/overflow-check/contracts";
import {
  OVERFLOW_VIEWPORTS,
  OverflowCheckReportSchema,
} from "../src/overflow-check/contracts";
import { OverflowCheckError } from "../src/overflow-check/error";
import {
  createOverflowMeasurement,
  evaluateOverflowCheck,
} from "../src/overflow-check/evaluate";
import { resolveOverflowCheckTarget } from "../src/overflow-check/options";
import { renderOverflowCheckReport } from "../src/overflow-check/render-human";
import type { TerminalCapabilities } from "../src/terminal-capabilities";

const AUDIT_LANGUAGE_PATTERN = /score|grade|rule/iu;

const PLAIN_TERMINAL = {
  color: false,
  columns: null,
  unicode: false,
} as const satisfies TerminalCapabilities;

const createMeasurement = ({
  clientWidth = 320,
  culprits,
  forcedScrollbar = false,
  page = "/",
  scrollWidth = clientWidth,
  viewport = OVERFLOW_VIEWPORTS[0],
}: Partial<OverflowMeasurementInput> = {}): OverflowMeasurementInput => ({
  clientWidth,
  culprits,
  finalPath: page,
  forcedScrollbar,
  httpStatus: 200,
  page,
  scrollWidth,
  viewport,
});

const createMeasurementMatrix = (
  page = "/",
  overrides: Partial<OverflowMeasurementInput> = {}
): OverflowMeasurementInput[] =>
  OVERFLOW_VIEWPORTS.map((viewport) =>
    createMeasurement({
      clientWidth: viewport.width,
      page,
      scrollWidth: viewport.width,
      viewport,
      ...overrides,
    })
  );

const evaluate = (
  measurements: OverflowMeasurementInput[] = createMeasurementMatrix()
): OverflowCheckReport =>
  evaluateOverflowCheck({
    durationMs: 42,
    measurements,
    target: { origin: "https://example.com", pages: ["/"] },
  });

describe("resolveOverflowCheckTarget", () => {
  it("preserves the exact navigable target while redacting report secrets", () => {
    const target = resolveOverflowCheckTarget({
      routes: ["/dashboard", "/dashboard", "/settings/profile"],
      target: "https://example.com/start?token=secret#private",
    });

    expect(target).toEqual({
      origin: "https://example.com",
      pages: [
        {
          displayPath: "/start?[redacted]#[redacted]",
          requestedUrl: "https://example.com/start?token=secret#private",
        },
        {
          displayPath: "/dashboard",
          requestedUrl: "https://example.com/dashboard",
        },
        {
          displayPath: "/settings/profile",
          requestedUrl: "https://example.com/settings/profile",
        },
      ],
    });
    expect(
      JSON.stringify(target.pages.map(({ displayPath }) => displayPath))
    ).not.toContain("secret");
  });

  it.each([
    "ftp://example.com",
    "https://user:password@example.com",
    "https://example.com/\n",
    "not a URL",
  ])("rejects unsafe targets: %s", (target) => {
    expect(() => resolveOverflowCheckTarget({ target })).toThrow(
      OverflowCheckError
    );
  });

  it.each([
    "dashboard",
    "//example.com/dashboard",
    "/dashboard?token=secret",
    "/dashboard#section",
    "/dashboard\\nested",
    "https://example.com/dashboard",
  ])("rejects a non-path route: %s", (route) => {
    expect(() =>
      resolveOverflowCheckTarget({
        routes: [route],
        target: "https://example.com",
      })
    ).toThrowError(
      "Overflow routes must start with one slash and cannot contain a query, hash, or backslash."
    );
  });

  it("rejects route controls before trimming input", () => {
    expect(() =>
      resolveOverflowCheckTarget({
        routes: ["/dashboard\n"],
        target: "https://example.com",
      })
    ).toThrowError("Each overflow route cannot contain control characters.");
  });

  it("caps the unique page set at ten", () => {
    expect(() =>
      resolveOverflowCheckTarget({
        routes: Array.from({ length: 10 }, (_, index) => `/page-${index}`),
        target: "https://example.com",
      })
    ).toThrowError("Overflow checks support at most 10 unique pages.");
  });

  it("rejects long routes that collide after safe report truncation", () => {
    const sharedPrefix = `/${"a".repeat(1100)}`;

    expect(() =>
      resolveOverflowCheckTarget({
        routes: [`${sharedPrefix}x`, `${sharedPrefix}y`],
        target: "https://example.com",
      })
    ).toThrowError(
      "Overflow page paths must remain unique within the report length limit."
    );
  });
});

describe("overflow report evaluation", () => {
  it("passes at zero pixels and fails at exactly one pixel", () => {
    expect(createOverflowMeasurement(createMeasurement()).status).toBe("pass");
    expect(
      createOverflowMeasurement(
        createMeasurement({ clientWidth: 320, scrollWidth: 321 })
      )
    ).toMatchObject({ overflowPx: 1, status: "fail" });
  });

  it("fails a forced root scrollbar with no width delta", () => {
    expect(
      createOverflowMeasurement(createMeasurement({ forcedScrollbar: true }))
    ).toMatchObject({
      culprits: [],
      forcedScrollbar: true,
      overflowPx: 0,
      status: "fail",
    });
  });

  it("reports browser-clamped extremely wide documents as findings", () => {
    expect(
      createOverflowMeasurement(
        createMeasurement({ clientWidth: 320, scrollWidth: 20_000_000 })
      )
    ).toMatchObject({ overflowPx: 19_999_680, status: "fail" });
  });

  it("sorts, sanitizes, and caps culprit evidence deterministically", () => {
    const candidates: OverflowCulpritCandidate[] = [
      {
        depth: 1,
        descriptor: "#earlier",
        left: 0,
        order: 0,
        overflowPx: 5,
        right: 325,
      },
      {
        depth: 3,
        descriptor: "div\u001b[31m\nwide",
        left: 0,
        order: 2,
        overflowPx: 5,
        right: 325,
      },
      {
        depth: 2,
        descriptor: "#largest",
        left: 0,
        order: 3,
        overflowPx: 12,
        right: 332,
      },
      {
        depth: 0,
        descriptor: "#omitted",
        left: 0,
        order: 4,
        overflowPx: 1,
        right: 321,
      },
    ];
    const measurement = createOverflowMeasurement(
      createMeasurement({
        clientWidth: 320,
        culprits: candidates,
        scrollWidth: 332,
      })
    );

    expect(measurement.culprits.map(({ descriptor }) => descriptor)).toEqual([
      "#largest",
      "div [31m wide",
      "#earlier",
    ]);
    expect(measurement.omittedCulprits).toBe(1);
    expect(JSON.stringify(measurement)).not.toContain("\u001b");
  });

  it("requires one mobile and one desktop result for every page", () => {
    expect(() => evaluate(createMeasurementMatrix().slice(0, 1))).toThrowError(
      "The browser returned an invalid horizontal overflow measurement."
    );
    expect(() =>
      evaluate([
        createMeasurement({ viewport: OVERFLOW_VIEWPORTS[1] }),
        createMeasurement({ viewport: OVERFLOW_VIEWPORTS[0] }),
      ])
    ).toThrowError(
      "The browser returned an invalid horizontal overflow measurement."
    );
  });

  it("validates report summary and status invariants", () => {
    const report = evaluate(
      createMeasurementMatrix("/", { scrollWidth: 1441 })
    );

    expect(report.status).toBe("fail");
    expect(report.summary).toEqual({
      failed: 2,
      maximumOverflowPx: 1121,
      measurements: 2,
    });
    expect(
      OverflowCheckReportSchema.safeParse({
        ...report,
        summary: { ...report.summary, failed: 0 },
      }).success
    ).toBe(false);
  });

  it("keeps a maximum-sized report below 100 KB", () => {
    const pages = Array.from({ length: 10 }, (_, index) => {
      const suffix = String(index);
      return `/${"p".repeat(1023 - suffix.length)}${suffix}`;
    });
    const culprits: OverflowCulpritCandidate[] = Array.from(
      { length: 3 },
      (_, index) => ({
        depth: index,
        descriptor: "c".repeat(160),
        left: 0,
        order: index,
        overflowPx: 1,
        right: 321,
      })
    );
    const measurements = pages.flatMap((page) =>
      OVERFLOW_VIEWPORTS.map((viewport) =>
        createMeasurement({
          clientWidth: viewport.width,
          culprits,
          page,
          scrollWidth: viewport.width + 1,
          viewport,
        })
      )
    );
    const report = evaluateOverflowCheck({
      durationMs: 60_000,
      measurements,
      target: { origin: "https://example.com", pages },
    });

    expect(
      Buffer.byteLength(JSON.stringify(report, null, 2), "utf8")
    ).toBeLessThan(100_000);
  });
});

describe("renderOverflowCheckReport", () => {
  it("renders a standalone critical failure without audit score language", () => {
    const culprit: OverflowCulpritCandidate = {
      depth: 1,
      descriptor: "#wide\u001b[31m",
      left: 0,
      order: 0,
      overflowPx: 1,
      right: 321,
    };
    const report = evaluate([
      createMeasurement({
        clientWidth: 320,
        culprits: [culprit],
        scrollWidth: 321,
        viewport: OVERFLOW_VIEWPORTS[0],
      }),
      createMeasurement({
        clientWidth: 1440,
        scrollWidth: 1440,
        viewport: OVERFLOW_VIEWPORTS[1],
      }),
    ]);
    const output = renderOverflowCheckReport(report, {
      terminal: PLAIN_TERMINAL,
    });

    expect(output).toContain("shadscan overflow check");
    expect(output).toContain("CRITICAL FAIL");
    expect(output).toContain("mobile 320x820");
    expect(output).toContain("Likely culprit: #wide [31m (1px)");
    expect(output).toContain("min-width: 0");
    expect(output).not.toMatch(AUDIT_LANGUAGE_PATTERN);
    expect(output).not.toContain("\u001b");
  });

  it("renders a concise pass", () => {
    const output = renderOverflowCheckReport(evaluate(), {
      terminal: PLAIN_TERMINAL,
    });

    expect(output).toContain("PASS");
    expect(output).toContain(
      "No horizontal overflow detected across 2 measurements."
    );
    expect(output).not.toContain("Remediation:");
  });
});
