import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { HostedScanError } from "./errors";

const API_KEY_PATTERN =
  /^shadscan_([A-Za-z0-9-]{1,64})_(?:[A-Za-z0-9._~-]{24,256})$/;
const AUTHORIZATION_SEPARATOR_PATTERN = /\s+/;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

const ApiKeyHashesSchema = z.record(
  z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  z.string().regex(SHA256_HEX_PATTERN)
);

interface AuthenticatedApiKey {
  keyId: string;
}

const hashApiKey = (apiKey: string): string =>
  createHash("sha256").update(apiKey, "utf8").digest("hex");

const parseConfiguredApiKeyHashes = (
  serializedHashes: string | undefined
): Record<string, string> => {
  if (!serializedHashes) {
    throw new HostedScanError("API authentication is not configured.", {
      code: "AUTH_NOT_CONFIGURED",
      status: 503,
    });
  }

  try {
    const parsedValue: unknown = JSON.parse(serializedHashes);
    const hashes = ApiKeyHashesSchema.parse(parsedValue);

    if (Object.keys(hashes).length === 0) {
      throw new Error("At least one key is required.");
    }

    return hashes;
  } catch (error) {
    throw new HostedScanError("API authentication is not configured.", {
      cause: error,
      code: "AUTH_NOT_CONFIGURED",
      status: 503,
    });
  }
};

const getBearerToken = (request: Request): string => {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    throw new HostedScanError("A valid Bearer API key is required.", {
      code: "UNAUTHORIZED",
      status: 401,
    });
  }

  const [scheme, token, ...rest] = authorization
    .trim()
    .split(AUTHORIZATION_SEPARATOR_PATTERN);
  if (
    rest.length > 0 ||
    scheme?.toLowerCase() !== "bearer" ||
    token === undefined
  ) {
    throw new HostedScanError("A valid Bearer API key is required.", {
      code: "UNAUTHORIZED",
      status: 401,
    });
  }

  return token;
};

const authenticateApiRequest = (
  request: Request,
  serializedHashes = process.env.SHADSCAN_API_KEY_HASHES
): AuthenticatedApiKey => {
  const configuredHashes = parseConfiguredApiKeyHashes(serializedHashes);
  const token = getBearerToken(request);
  const match = API_KEY_PATTERN.exec(token);
  const keyId = match?.[1];
  const configuredHash =
    keyId && Object.hasOwn(configuredHashes, keyId)
      ? configuredHashes[keyId]
      : undefined;
  const expectedHash = Buffer.from(configuredHash ?? "0".repeat(64), "hex");
  const presentedHash = Buffer.from(hashApiKey(token), "hex");
  const hashMatches =
    expectedHash.length === presentedHash.length &&
    timingSafeEqual(expectedHash, presentedHash);

  if (keyId === undefined || configuredHash === undefined || !hashMatches) {
    throw new HostedScanError("A valid Bearer API key is required.", {
      code: "UNAUTHORIZED",
      status: 401,
    });
  }

  return { keyId };
};

export type { AuthenticatedApiKey };
export { authenticateApiRequest, hashApiKey };
