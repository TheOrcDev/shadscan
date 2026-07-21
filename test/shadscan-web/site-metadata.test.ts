import { describe, expect, it } from "vitest";
import { createPageMetadata, createRobotsMetadata } from "@/lib/site-metadata";
import { getSiteUrl } from "@/lib/site-url";

describe("site URL resolution", () => {
  it("prefers an explicitly configured public URL", () => {
    expect(
      getSiteUrl({
        NEXT_PUBLIC_SITE_URL: "docs.example.com",
        NODE_ENV: "production",
      }).href
    ).toBe("https://docs.example.com/");
  });

  it("uses the stable production deployment when no URL is configured", () => {
    expect(getSiteUrl({ NODE_ENV: "production" }).href).toBe(
      "https://www.shadscan.com/"
    );
  });

  it("uses localhost outside production", () => {
    expect(getSiteUrl({ NODE_ENV: "test" }).href).toBe(
      "http://localhost:3000/"
    );
  });
});

describe("page metadata", () => {
  it("emits a complete social metadata object for a child route", () => {
    const metadata = createPageMetadata({
      description: "A deterministic test description.",
      imageAlt: "A test social card",
      imagePath: "/scan/opengraph-image",
      path: "/scan",
      title: "Scan a shadcn app",
    });

    expect(metadata).toMatchObject({
      alternates: { canonical: "/scan" },
      description: "A deterministic test description.",
      openGraph: {
        description: "A deterministic test description.",
        images: [
          {
            alt: "A test social card",
            height: 630,
            type: "image/png",
            url: "/scan/opengraph-image",
            width: 1200,
          },
        ],
        locale: "en_US",
        siteName: "shadscan",
        title: "Scan a shadcn app | shadscan",
        type: "website",
        url: "/scan",
      },
      title: "Scan a shadcn app",
      twitter: {
        card: "summary_large_image",
        description: "A deterministic test description.",
        images: [
          {
            alt: "A test social card",
            url: "/scan/opengraph-image",
          },
        ],
        title: "Scan a shadcn app | shadscan",
      },
    });
  });

  it("blocks preview deployments from indexing", () => {
    expect(createRobotsMetadata("preview")).toMatchObject({
      follow: false,
      googleBot: { follow: false, index: false, noimageindex: true },
      index: false,
      nocache: true,
    });
  });

  it("allows production deployments to be indexed with rich previews", () => {
    expect(createRobotsMetadata("production")).toMatchObject({
      follow: true,
      googleBot: {
        follow: true,
        index: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
      index: true,
    });
  });
});
