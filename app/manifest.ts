import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site-metadata";

export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: "#ffffff",
    description: SITE_DESCRIPTION,
    display: "standalone",
    icons: [
      {
        purpose: "any",
        sizes: "192x192",
        src: "/icons/shadscan-192.png",
        type: "image/png",
      },
      {
        purpose: "any",
        sizes: "512x512",
        src: "/icons/shadscan-512.png",
        type: "image/png",
      },
      {
        purpose: "maskable",
        sizes: "512x512",
        src: "/icons/shadscan-maskable-512.png",
        type: "image/png",
      },
    ],
    id: "/",
    lang: "en",
    name: SITE_NAME,
    scope: "/",
    short_name: SITE_NAME,
    start_url: "/",
    theme_color: "#171717",
  };
}
