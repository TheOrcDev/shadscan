import { z } from "zod";
import { WebScanJobPollResponseSchema } from "@/lib/shadscan-web/contracts";
import { getScanJobStatus } from "@/lib/shadscan-web/scan-jobs";

const JobIdSchema = z.string().uuid();
const JobTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const BEARER_PREFIX = "Bearer ";
const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
} as const;

const getBearerToken = (request: Request): string | undefined => {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith(BEARER_PREFIX)) {
    return;
  }
  const token = authorization.slice(BEARER_PREFIX.length);
  return JobTokenSchema.safeParse(token).success ? token : undefined;
};

export async function GET(
  request: Request,
  context: RouteContext<"/api/scan-jobs/[jobId]">
): Promise<Response> {
  const { jobId: jobIdInput } = await context.params;
  const jobId = JobIdSchema.safeParse(jobIdInput);
  const jobToken = getBearerToken(request);
  if (!(jobId.success && jobToken)) {
    return Response.json(
      { error: "Queued scan not found." },
      { headers: RESPONSE_HEADERS, status: 404 }
    );
  }

  try {
    const status = await getScanJobStatus(jobId.data, jobToken);
    if (!status) {
      return Response.json(
        { error: "Queued scan not found." },
        { headers: RESPONSE_HEADERS, status: 404 }
      );
    }
    return Response.json(WebScanJobPollResponseSchema.parse(status), {
      headers: RESPONSE_HEADERS,
    });
  } catch {
    return Response.json(
      { error: "Queued scan status is temporarily unavailable." },
      {
        headers: { ...RESPONSE_HEADERS, "Retry-After": "3" },
        status: 503,
      }
    );
  }
}
