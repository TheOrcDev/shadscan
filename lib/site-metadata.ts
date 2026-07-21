import type { Metadata } from "next";

const SITE_NAME = "shadscan";
const SITE_DEFAULT_TITLE = "shadscan: Audit shadcn apps for UI fundamentals";
const SITE_DESCRIPTION =
  "Audit accessibility, UI states, navigation, forms, metadata, and production polish with deterministic evidence and agent-ready fixes.";
const SITE_LOCALE = "en_US";
const ORCDEV_URL = "https://orcdev.com";
const NPM_PACKAGE_URL = "https://www.npmjs.com/package/@shadscan/cli";

interface PageMetadataOptions {
  description: string;
  imageAlt?: string;
  imagePath?: `/${string}`;
  path: `/${string}` | "/";
  socialTitle?: string;
  title: string;
}

const createPageMetadata = ({
  description,
  imageAlt = "shadscan, the deterministic UI audit CLI for shadcn apps",
  imagePath = "/opengraph-image",
  path,
  socialTitle,
  title,
}: PageMetadataOptions): Metadata => {
  const resolvedSocialTitle = socialTitle ?? `${title} | ${SITE_NAME}`;
  const socialImage = {
    alt: imageAlt,
    height: 630,
    type: "image/png",
    url: imagePath,
    width: 1200,
  } as const;

  return {
    alternates: { canonical: path },
    description,
    openGraph: {
      description,
      images: [socialImage],
      locale: SITE_LOCALE,
      siteName: SITE_NAME,
      title: resolvedSocialTitle,
      type: "website",
      url: path,
    },
    title,
    twitter: {
      card: "summary_large_image",
      description,
      images: [{ alt: imageAlt, url: imagePath }],
      title: resolvedSocialTitle,
    },
  };
};

const createRobotsMetadata = (
  vercelEnvironment = process.env.VERCEL_ENV
): Metadata["robots"] => {
  if (vercelEnvironment === "preview") {
    return {
      follow: false,
      googleBot: {
        follow: false,
        index: false,
        noimageindex: true,
      },
      index: false,
      nocache: true,
    };
  }

  return {
    follow: true,
    googleBot: {
      follow: true,
      index: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
      noimageindex: false,
    },
    index: true,
  };
};

export {
  createPageMetadata,
  createRobotsMetadata,
  NPM_PACKAGE_URL,
  ORCDEV_URL,
  SITE_DEFAULT_TITLE,
  SITE_DESCRIPTION,
  SITE_NAME,
};
