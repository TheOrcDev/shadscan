import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
}));

vi.mock("@/lib/shadscan-web/scan-jobs", () => ({
  getScanJobStatus: mocks.getStatus,
}));
vi.mock(
  "@/lib/shadscan-web/contracts",
  () => import("../../lib/shadscan-web/contracts")
);

const { GET } = await import("../../app/api/scan-jobs/[jobId]/route");

const JOB_ID = "9e83046c-84aa-4da2-a9ef-ec2b38f7058e";
const JOB_TOKEN = "a".repeat(64);
const createContext = (jobId = JOB_ID) => ({
  params: Promise.resolve({ jobId }),
});

beforeEach(() => {
  mocks.getStatus.mockReset();
});

describe("queued scan status route", () => {
  it("rejects malformed bearer credentials without touching Neon", async () => {
    const response = await GET(
      new Request(`https://shadscan.com/api/scan-jobs/${JOB_ID}`, {
        headers: { Authorization: "Bearer invalid" },
      }),
      createContext()
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(mocks.getStatus).not.toHaveBeenCalled();
  });

  it("returns an opaque, non-cacheable running status", async () => {
    mocks.getStatus.mockResolvedValue({
      pollAfterMs: 1500,
      status: "running",
    });

    const response = await GET(
      new Request(`https://shadscan.com/api/scan-jobs/${JOB_ID}`, {
        headers: { Authorization: `Bearer ${JOB_TOKEN}` },
      }),
      createContext()
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      pollAfterMs: 1500,
      status: "running",
    });
    expect(mocks.getStatus).toHaveBeenCalledWith(JOB_ID, JOB_TOKEN);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
  });

  it("fails closed when durable status cannot be read", async () => {
    mocks.getStatus.mockRejectedValue(new Error("database unavailable"));

    const response = await GET(
      new Request(`https://shadscan.com/api/scan-jobs/${JOB_ID}`, {
        headers: { Authorization: `Bearer ${JOB_TOKEN}` },
      }),
      createContext()
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("3");
  });
});
