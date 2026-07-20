const LOCAL_SITE_URL = "http://localhost:3000";
const PRODUCTION_SITE_URL = "https://shadscan.vercel.app";

interface SiteUrlEnvironment {
  NEXT_PUBLIC_SITE_URL?: string;
  NODE_ENV?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
}

const withProtocol = (value: string): string =>
  value.startsWith("http://") || value.startsWith("https://")
    ? value
    : `https://${value}`;

const getSiteUrl = (environment: SiteUrlEnvironment = process.env): URL => {
  const configuredUrl = environment.NEXT_PUBLIC_SITE_URL;
  const vercelProductionUrl = environment.VERCEL_PROJECT_PRODUCTION_URL;
  const fallbackUrl =
    environment.NODE_ENV === "production"
      ? PRODUCTION_SITE_URL
      : LOCAL_SITE_URL;

  return new URL(
    withProtocol(configuredUrl ?? vercelProductionUrl ?? fallbackUrl)
  );
};

export { getSiteUrl };
