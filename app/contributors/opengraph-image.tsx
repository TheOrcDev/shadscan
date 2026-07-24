import { ImageResponse } from "next/og";
import { SocialCard } from "@/components/social-card";

const size = {
  height: 630,
  width: 1200,
};

const alt = "The people who build shadscan";
const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <SocialCard
      detail="Every rule ships because someone sent a pull request."
      footer="Built in the open. Join the contributors."
      headline="The people behind shadscan."
    />,
    size
  );
}

export { alt, contentType, size };
