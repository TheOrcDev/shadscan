import { createHash, randomBytes } from "node:crypto";

const KEY_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const keyId = process.argv[2];

if (keyId && KEY_ID_PATTERN.test(keyId)) {
  const apiKey = `shadscan_${keyId}_${randomBytes(32).toString("base64url")}`;
  const apiKeyHash = createHash("sha256").update(apiKey, "utf8").digest("hex");

  process.stdout.write(
    [
      "API key (store once as SHADSCAN_API_KEY):",
      apiKey,
      "",
      "SHADSCAN_API_KEY_HASHES value (store on the server):",
      JSON.stringify({ [keyId]: apiKeyHash }),
      "",
    ].join("\n")
  );
} else {
  process.stderr.write(
    "Usage: pnpm api:keygen <key-id>\nThe key ID must contain 1-64 letters, numbers, or hyphens.\n"
  );
  process.exitCode = 1;
}
