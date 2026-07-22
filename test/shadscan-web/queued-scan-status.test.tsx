import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QueuedScanStatus } from "@/app/scan/queued-scan-status";

describe("QueuedScanStatus", () => {
  it.each([
    ["queued", "Scan queued"],
    ["running", "Scanning repository"],
  ] as const)("renders the accessible %s progress state", (status, label) => {
    const markup = renderToStaticMarkup(<QueuedScanStatus status={status} />);

    expect(markup).toContain(label);
    expect(markup).toContain('data-slot="spinner"');
    expect(markup).toContain('data-slot="skeleton"');
    expect(markup).not.toContain("jobToken");
  });
});
