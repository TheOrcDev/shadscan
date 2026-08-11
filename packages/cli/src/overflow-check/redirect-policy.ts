import { isIP } from "node:net";

interface CanonicalRedirectPolicy {
  readonly hostnameAliasUsed: boolean;
  readonly originalOrigin: string;
  readonly protocolUpgradeUsed: boolean;
  readonly resolvedOrigin: string;
}

const parseHttpUrl = (value: string): URL | null => {
  try {
    const url = new URL(value);
    const isHttp = url.protocol === "http:" || url.protocol === "https:";
    const hasCredentials = url.username !== "" || url.password !== "";

    return isHttp && !hasCredentials ? url : null;
  } catch {
    return null;
  }
};

const createCanonicalRedirectPolicy = (
  initialUrl: string
): CanonicalRedirectPolicy | null => {
  const parsedUrl = parseHttpUrl(initialUrl);

  if (!parsedUrl) {
    return null;
  }

  return {
    hostnameAliasUsed: false,
    originalOrigin: parsedUrl.origin,
    protocolUpgradeUsed: false,
    resolvedOrigin: parsedUrl.origin,
  };
};

const getHostnameAlias = (hostname: string): string | null => {
  const unwrappedHostname =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;

  if (isIP(unwrappedHostname) !== 0 || hostname.startsWith("www.www.")) {
    return null;
  }

  const apexHostname = hostname.startsWith("www.")
    ? hostname.slice(4)
    : hostname;
  const apexLabels = apexHostname.split(".");
  const hasConservativeApexShape =
    apexHostname === "localhost" ||
    (apexLabels.length === 2 && apexLabels.every(Boolean));
  if (!hasConservativeApexShape) {
    return null;
  }

  return hostname.startsWith("www.") ? apexHostname : `www.${apexHostname}`;
};

const followCanonicalServerRedirect = (
  policy: CanonicalRedirectPolicy,
  nextUrl: string
): CanonicalRedirectPolicy | null => {
  const parsedUrl = parseHttpUrl(nextUrl);

  if (!parsedUrl) {
    return null;
  }

  if (parsedUrl.origin === policy.resolvedOrigin) {
    return policy;
  }

  const currentUrl = new URL(policy.resolvedOrigin);
  const originalUrl = new URL(policy.originalOrigin);
  const hostnameChanges = parsedUrl.hostname !== currentUrl.hostname;
  const protocolChanges = parsedUrl.protocol !== currentUrl.protocol;
  const isAnchoredHostnameAlias =
    !policy.hostnameAliasUsed &&
    currentUrl.hostname === originalUrl.hostname &&
    parsedUrl.hostname === getHostnameAlias(originalUrl.hostname);
  const isDefaultPortProtocolUpgrade =
    !policy.protocolUpgradeUsed &&
    currentUrl.protocol === "http:" &&
    parsedUrl.protocol === "https:" &&
    currentUrl.port === "" &&
    parsedUrl.port === "";
  const hostnameIsAllowed = !hostnameChanges || isAnchoredHostnameAlias;
  const protocolIsAllowed = !protocolChanges || isDefaultPortProtocolUpgrade;
  const portIsAllowed = protocolChanges
    ? isDefaultPortProtocolUpgrade
    : parsedUrl.port === currentUrl.port;

  if (!(hostnameIsAllowed && protocolIsAllowed && portIsAllowed)) {
    return null;
  }

  return {
    ...policy,
    hostnameAliasUsed: policy.hostnameAliasUsed || hostnameChanges,
    protocolUpgradeUsed: policy.protocolUpgradeUsed || protocolChanges,
    resolvedOrigin: parsedUrl.origin,
  };
};

export type { CanonicalRedirectPolicy };
export { createCanonicalRedirectPolicy, followCanonicalServerRedirect };
