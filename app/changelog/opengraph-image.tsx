import { ImageResponse } from "next/og";
import { SocialCard } from "@/components/social-card";

const size = {
  height: 630,
  width: 1200,
};

const alt = "Shadscan release changelog";
const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <SocialCard
      detail="New rules, CLI features, web scanner improvements, and fixes."
      footer="Changelog"
      headline="Every Shadscan release, explained."
    />,
    size
  );
}

export { alt, contentType, size };
