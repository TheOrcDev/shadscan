import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();

  return {
    host: siteUrl.href,
    rules: {
      allow: "/",
      userAgent: "*",
    },
    sitemap: new URL("/sitemap.xml", siteUrl).href,
  };
}
