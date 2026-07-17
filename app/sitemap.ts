import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-url";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      changeFrequency: "weekly",
      priority: 1,
      url: getSiteUrl().href,
    },
  ];
}
