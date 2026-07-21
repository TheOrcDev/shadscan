import {
  AGENT_INSTRUCTIONS_MARKDOWN,
  AGENT_INSTRUCTIONS_SHA256,
  AGENT_INSTRUCTIONS_VERSION,
  SHADSCAN_AGENT_INSTRUCTIONS_URL,
  SHADSCAN_OPENAPI_URL,
} from "../../../lib/shadscan-api/agent-instructions";

export const dynamic = "force-static";

export const GET = (): Response =>
  new Response(AGENT_INSTRUCTIONS_MARKDOWN, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": "text/markdown; charset=utf-8",
      ETag: `"${AGENT_INSTRUCTIONS_SHA256}"`,
      Link: `<${SHADSCAN_AGENT_INSTRUCTIONS_URL}>; rel="canonical", <${SHADSCAN_OPENAPI_URL}>; rel="service-desc"`,
      "X-Content-Type-Options": "nosniff",
      "X-Shadscan-Agent-Instructions-Version":
        AGENT_INSTRUCTIONS_VERSION.toString(),
    },
    status: 200,
  });
