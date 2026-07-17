import {
  AGENT_INSTRUCTIONS_MARKDOWN,
  SHADSCAN_OPENAPI_URL,
} from "../../lib/shadscan-api/agent-instructions";

export const dynamic = "force-static";

const DISCOVERY_CACHE_CONTROL =
  "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";

export const GET = (): Response =>
  new Response(AGENT_INSTRUCTIONS_MARKDOWN, {
    headers: {
      "Cache-Control": DISCOVERY_CACHE_CONTROL,
      "Content-Type": "text/markdown; charset=utf-8",
      Link: `<${SHADSCAN_OPENAPI_URL}>; rel="service-desc"`,
      "X-Content-Type-Options": "nosniff",
    },
    status: 200,
  });
