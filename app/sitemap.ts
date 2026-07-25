import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-url";

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl();

  return [
    {
      changeFrequency: "weekly",
      priority: 1,
      url: siteUrl.href,
    },
    {
      changeFrequency: "monthly",
      priority: 0.8,
      url: new URL("/docs", siteUrl).href,
    },
    {
      changeFrequency: "weekly",
      priority: 0.8,
      url: new URL("/rules", siteUrl).href,
    },
    {
      changeFrequency: "weekly",
      priority: 0.7,
      url: new URL("/changelog", siteUrl).href,
    },
    {
      changeFrequency: "weekly",
      priority: 0.9,
      url: new URL("/scan", siteUrl).href,
    },
    {
      changeFrequency: "monthly",
      priority: 0.6,
      url: new URL("/sponsors", siteUrl).href,
    },
    {
      changeFrequency: "weekly",
      priority: 0.5,
      url: new URL("/contributors", siteUrl).href,
    },
    {
      changeFrequency: "yearly",
      priority: 0.2,
      url: new URL("/privacy", siteUrl).href,
    },
    {
      changeFrequency: "yearly",
      priority: 0.2,
      url: new URL("/terms", siteUrl).href,
    },
  ];
}
