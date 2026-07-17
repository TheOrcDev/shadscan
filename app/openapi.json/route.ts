import { SHADSCAN_AGENT_INSTRUCTIONS_URL } from "../../lib/shadscan-api/agent-instructions";
import { OPENAPI_DOCUMENT } from "../../lib/shadscan-api/openapi";

export const dynamic = "force-static";

const DISCOVERY_CACHE_CONTROL =
  "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";

export const GET = (): Response =>
  new Response(JSON.stringify(OPENAPI_DOCUMENT), {
    headers: {
      "Cache-Control": DISCOVERY_CACHE_CONTROL,
      "Content-Type": "application/json; charset=utf-8",
      Link: `<${SHADSCAN_AGENT_INSTRUCTIONS_URL}>; rel="help"; type="text/markdown"`,
      "X-Content-Type-Options": "nosniff",
    },
    status: 200,
  });
