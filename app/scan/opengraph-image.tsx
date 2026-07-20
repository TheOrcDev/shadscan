import { ImageResponse } from "next/og";
import { SocialCard } from "@/components/social-card";

const size = {
  height: 630,
  width: 1200,
};

const alt = "Scan a public shadcn repository with shadscan";
const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <SocialCard
      detail="Deterministic score. Cited evidence. Actionable fixes."
      footer="Paste a public GitHub repository."
      headline="Scan a public shadcn repository."
    />,
    size
  );
}

export { alt, contentType, size };
