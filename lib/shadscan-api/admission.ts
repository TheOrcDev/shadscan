import { HostedScanError } from "./errors";

const MAX_CONCURRENT_HOSTED_SCANS = 2;
const HOSTED_SCAN_BUSY_RETRY_SECONDS = 5;

type HostedScanOperation<Result> = () => Promise<Result> | Result;

class HostedScanAdmissionController {
  private activeScanCount = 0;
  private readonly maximumConcurrentScans: number;

  constructor(maximumConcurrentScans = MAX_CONCURRENT_HOSTED_SCANS) {
    if (
      !Number.isSafeInteger(maximumConcurrentScans) ||
      maximumConcurrentScans < 1
    ) {
      throw new RangeError(
        "Hosted scan concurrency must be a positive safe integer."
      );
    }
    this.maximumConcurrentScans = maximumConcurrentScans;
  }

  async run<Result>(operation: HostedScanOperation<Result>): Promise<Result> {
    if (this.activeScanCount >= this.maximumConcurrentScans) {
      throw new HostedScanError(
        "The hosted scanner is at capacity. Try again shortly.",
        {
          code: "SCAN_BUSY",
          headers: {
            "Retry-After": HOSTED_SCAN_BUSY_RETRY_SECONDS.toString(),
          },
          retryable: true,
          status: 503,
        }
      );
    }

    this.activeScanCount += 1;
    try {
      return await operation();
    } finally {
      this.activeScanCount -= 1;
    }
  }
}

const hostedScanAdmissionController = new HostedScanAdmissionController();

export {
  HOSTED_SCAN_BUSY_RETRY_SECONDS,
  HostedScanAdmissionController,
  hostedScanAdmissionController,
  MAX_CONCURRENT_HOSTED_SCANS,
};
