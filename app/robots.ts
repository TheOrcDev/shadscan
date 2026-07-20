import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();
  const isPreviewDeployment = process.env.VERCEL_ENV === "preview";

  return {
    host: siteUrl.href,
    rules: isPreviewDeployment
      ? { disallow: "/", userAgent: "*" }
      : { allow: "/", userAgent: "*" },
    sitemap: new URL("/sitemap.xml", siteUrl).href,
  };
}
