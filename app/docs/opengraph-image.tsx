import { ImageResponse } from "next/og";
import { SocialCard } from "@/components/social-card";

const size = {
  height: 630,
  width: 1200,
};

const alt = "Shadscan CLI usage, options, and agent prompt output";
const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <SocialCard
      detail="Human reports, structured JSON, or a paste-ready agent prompt."
      footer="CLI documentation"
      headline="Run Shadscan in any shadcn app."
    />,
    size
  );
}

export { alt, contentType, size };
