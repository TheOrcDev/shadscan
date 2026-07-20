import { ImageResponse } from "next/og";
import { SocialCard } from "@/components/social-card";

const size = {
  height: 630,
  width: 1200,
};

const alt = "Sponsor deterministic UI audits with shadscan";
const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <SocialCard
      detail="Help open-source UI auditing keep shipping."
      footer="Support shadscan. Be seen by its users."
      headline="Sponsor deterministic UI audits."
    />,
    size
  );
}

export { alt, contentType, size };
