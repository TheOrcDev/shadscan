import {
  GITHUB_REPOSITORY_URL,
  NPM_PACKAGE_URL,
  ORCDEV_URL,
  SITE_DESCRIPTION,
  SITE_NAME,
} from "@/lib/site-metadata";
import { getSiteUrl } from "@/lib/site-url";

const serializeStructuredData = (value: unknown): string =>
  JSON.stringify(value).replaceAll("<", "\\u003c");

function SiteStructuredData() {
  const siteUrl = getSiteUrl().href;
  const organizationId = `${siteUrl}#organization`;
  const websiteId = `${siteUrl}#website`;
  const softwareId = `${siteUrl}#software`;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@id": organizationId,
        "@type": "Organization",
        name: "OrcDev",
        url: ORCDEV_URL,
      },
      {
        "@id": websiteId,
        "@type": "WebSite",
        description: SITE_DESCRIPTION,
        name: SITE_NAME,
        publisher: { "@id": organizationId },
        url: siteUrl,
      },
      {
        "@id": softwareId,
        "@type": "SoftwareApplication",
        applicationCategory: "DeveloperApplication",
        description: SITE_DESCRIPTION,
        downloadUrl: NPM_PACKAGE_URL,
        isAccessibleForFree: true,
        license: "https://opensource.org/license/mit",
        name: SITE_NAME,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
        operatingSystem: "macOS, Windows, Linux",
        publisher: { "@id": organizationId },
        sameAs: [GITHUB_REPOSITORY_URL, NPM_PACKAGE_URL],
        url: siteUrl,
      },
    ],
  };

  return (
    <script
      // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD requires raw script content, which is escaped above.
      dangerouslySetInnerHTML={{
        __html: serializeStructuredData(structuredData),
      }}
      type="application/ld+json"
    />
  );
}

export { SiteStructuredData };
