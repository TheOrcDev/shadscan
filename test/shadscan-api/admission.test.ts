import { describe, expect, it } from "vitest";
import {
  HOSTED_SCAN_BUSY_RETRY_SECONDS,
  HostedScanAdmissionController,
} from "../../lib/shadscan-api/admission";

describe("HostedScanAdmissionController", () => {
  it("rejects excess work immediately without queueing it", async () => {
    const admissionController = new HostedScanAdmissionController(2);
    const firstOperation = Promise.withResolvers<void>();
    const secondOperation = Promise.withResolvers<void>();
    const firstRun = admissionController.run(() => firstOperation.promise);
    const secondRun = admissionController.run(() => secondOperation.promise);
    let excessOperationStarted = false;

    await expect(
      admissionController.run(() => {
        excessOperationStarted = true;
      })
    ).rejects.toMatchObject({
      code: "SCAN_BUSY",
      retryable: true,
      status: 503,
    });
    await expect(admissionController.run(() => undefined)).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof Error &&
        "headers" in error &&
        error.headers instanceof Headers &&
        error.headers.get("retry-after") ===
          HOSTED_SCAN_BUSY_RETRY_SECONDS.toString()
    );
    expect(excessOperationStarted).toBe(false);

    firstOperation.resolve();
    secondOperation.resolve();
    await Promise.all([firstRun, secondRun]);
  });

  it("releases a slot after successful and failed operations", async () => {
    const admissionController = new HostedScanAdmissionController(1);

    await expect(admissionController.run(() => "completed")).resolves.toBe(
      "completed"
    );
    await expect(
      admissionController.run(() => {
        throw new Error("expected operation failure");
      })
    ).rejects.toThrow("expected operation failure");
    await expect(admissionController.run(() => "admitted again")).resolves.toBe(
      "admitted again"
    );
  });

  it("rejects invalid concurrency limits", () => {
    expect(() => new HostedScanAdmissionController(0)).toThrow(RangeError);
    expect(() => new HostedScanAdmissionController(1.5)).toThrow(RangeError);
  });
});
