import { ImageResponse } from "next/og";
import { SocialCard } from "@/components/social-card";

const size = {
  height: 630,
  width: 1200,
};

const alt = "Make AI agents run shadscan before every commit";
const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <SocialCard
      detail="Baseline first. Audit immediately before each commit."
      footer="Agent workflow. No Git hooks."
      headline="Make agents run Shadscan before every commit."
    />,
    size
  );
}

export { alt, contentType, size };
