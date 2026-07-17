const LOCAL_SITE_URL = "http://localhost:3000";

const withProtocol = (value: string): string =>
  value.startsWith("http://") || value.startsWith("https://")
    ? value
    : `https://${value}`;

const getSiteUrl = (): URL => {
  const configuredUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    LOCAL_SITE_URL;

  return new URL(withProtocol(configuredUrl));
};

export { getSiteUrl };
