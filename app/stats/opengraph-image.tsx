import { ImageResponse } from "next/og";
import { SocialCard } from "@/components/social-card";
import { getNpmStats } from "@/lib/npm-stats";
import { createStatsSocialCopy } from "@/lib/stats-social-copy";

const size = {
  height: 630,
  width: 1200,
};

const alt = "shadscan usage stats: npm downloads and version adoption";
const contentType = "image/png";

// Matches the page's own refresh so a shared card never cites numbers the page
// has already moved past. Segment config must be a literal.
export const revalidate = 3600;

export default async function OpenGraphImage() {
  const stats = await getNpmStats().catch(() => null);
  const { detail, footer, headline } = createStatsSocialCopy(stats);

  return new ImageResponse(
    <SocialCard detail={detail} footer={footer} headline={headline} />,
    size
  );
}

export { alt, contentType, size };
