import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { AuditReport } from "@shadscan/cli";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { maxDuration, POST } from "../../app/v1/scans/route";
import { hashApiKey } from "../../lib/shadscan-api/auth";
import type {
  HostedScanErrorBody,
  HostedScanResponse,
} from "../../lib/shadscan-api/contracts";
import { HOSTED_SCAN_DEADLINE_MS } from "../../lib/shadscan-api/deadline";
import { GITHUB_SOURCE_TIMEOUT_MS } from "../../lib/shadscan-api/github-source";
import {
  JSON_MEDIA_TYPE,
  MARKDOWN_MEDIA_TYPE,
  SNAPSHOT_MEDIA_TYPE,
} from "../../lib/shadscan-api/protocol";
import { resetMemoryRateLimits } from "../../lib/shadscan-api/rate-limit";
import { MAX_SNAPSHOT_BYTES } from "../../lib/shadscan-api/snapshot-source";
import { createTarGzip } from "./test-archive";

vi.mock("@/lib/shadscan-api/auth", () => import("../../lib/shadscan-api/auth"));
vi.mock(
  "@/lib/shadscan-api/contracts",
  () => import("../../lib/shadscan-api/contracts")
);
vi.mock(
  "@/lib/shadscan-api/errors",
  () => import("../../lib/shadscan-api/errors")
);
vi.mock(
  "@/lib/shadscan-api/deadline",
  () => import("../../lib/shadscan-api/deadline")
);
vi.mock(
  "@/lib/shadscan-api/github-source",
  () => import("../../lib/shadscan-api/github-source")
);
vi.mock(
  "@/lib/shadscan-api/rate-limit",
  () => import("../../lib/shadscan-api/rate-limit")
);
vi.mock(
  "@/lib/shadscan-api/protocol",
  () => import("../../lib/shadscan-api/protocol")
);
vi.mock(
  "@/lib/shadscan-api/run-hosted-scan",
  () => import("../../lib/shadscan-api/run-hosted-scan")
);
vi.mock(
  "@/lib/shadscan-api/snapshot-source",
  () => import("../../lib/shadscan-api/snapshot-source")
);

const PRIMARY_API_KEY = "shadscan_route_abcdefghijklmnopqrstuvwxyz0123456789";
const SECONDARY_API_KEY = "shadscan_other_abcdefghijklmnopqrstuvwxyz9876543210";
const API_KEY_HASHES = JSON.stringify({
  other: hashApiKey(SECONDARY_API_KEY),
  route: hashApiKey(PRIMARY_API_KEY),
});
const SCAN_URL = "https://www.shadscan.com/v1/scans";
const IMMUTABLE_COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";
const SCAN_ID_PATTERN = /^scan_[a-f0-9]{32}$/;
const CLI_ENTRYPOINT = resolve("packages/cli/dist/cli.js");
const execFileAsync = promisify(execFile);
const FIXTURE_PACKAGE_JSON = `${JSON.stringify({
  dependencies: { react: "19.2.4" },
  name: "hosted-route-fixture",
})}\n`;
const FIXTURE_APP_SOURCE = "export const App = () => <main>Fixture</main>;\n";

const originalEnvironment = {
  apiKeyHashes: process.env.SHADSCAN_API_KEY_HASHES,
  githubToken: process.env.GITHUB_TOKEN,
  rateLimitMode: process.env.SHADSCAN_RATE_LIMIT_MODE,
};

const restoreEnvironmentValue = (
  name: "GITHUB_TOKEN" | "SHADSCAN_API_KEY_HASHES" | "SHADSCAN_RATE_LIMIT_MODE",
  value: string | undefined
): void => {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
};

const createMinimalReactSnapshot = (): Promise<Buffer> =>
  createTarGzip([
    {
      contents: FIXTURE_PACKAGE_JSON,
      header: { name: "package.json", type: "file" },
    },
    {
      contents: FIXTURE_APP_SOURCE,
      header: { name: "src/App.tsx", type: "file" },
    },
  ]);

const withoutExecutionMetadata = (
  report: AuditReport
): Omit<AuditReport, "durationMs" | "source"> => {
  const { durationMs: _durationMs, source: _source, ...stableReport } = report;
  return stableReport;
};

const createSnapshotRequest = (
  archive: Buffer,
  headers: HeadersInit = {},
  url = SCAN_URL
): Request =>
  new Request(url, {
    body: new Blob([Uint8Array.from(archive)]),
    headers: {
      authorization: `Bearer ${PRIMARY_API_KEY}`,
      "content-type": SNAPSHOT_MEDIA_TYPE,
      ...headers,
    },
    method: "POST",
  });

const createUnsupportedMediaRequest = (apiKey = PRIMARY_API_KEY): Request =>
  new Request(SCAN_URL, {
    body: "unsupported",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "text/plain",
    },
    method: "POST",
  });

const createGitHubRequest = (repository = "acme/widget"): Request =>
  new Request(SCAN_URL, {
    body: JSON.stringify({
      source: {
        kind: "github",
        repository,
        revision: "main",
      },
    }),
    headers: {
      authorization: `Bearer ${PRIMARY_API_KEY}`,
      "content-type": JSON_MEDIA_TYPE,
    },
    method: "POST",
  });

const getFetchUrl = (input: Parameters<typeof fetch>[0]): string =>
  input instanceof Request ? input.url : input.toString();

beforeEach(() => {
  process.env.SHADSCAN_API_KEY_HASHES = API_KEY_HASHES;
  process.env.SHADSCAN_RATE_LIMIT_MODE = "memory";
  delete process.env.GITHUB_TOKEN;
  resetMemoryRateLimits();
});

afterEach(() => {
  resetMemoryRateLimits();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreEnvironmentValue(
    "SHADSCAN_API_KEY_HASHES",
    originalEnvironment.apiKeyHashes
  );
  restoreEnvironmentValue(
    "SHADSCAN_RATE_LIMIT_MODE",
    originalEnvironment.rateLimitMode
  );
  restoreEnvironmentValue("GITHUB_TOKEN", originalEnvironment.githubToken);
});

describe("POST /v1/scans", () => {
  it("reserves route time for extraction and scanning after GitHub fetches", () => {
    expect(GITHUB_SOURCE_TIMEOUT_MS).toBeLessThan(HOSTED_SCAN_DEADLINE_MS);
    expect(HOSTED_SCAN_DEADLINE_MS).toBeLessThan(maxDuration * 1000);
  });

  it("returns a completed JSON scan for an authenticated snapshot", async () => {
    const archive = await createMinimalReactSnapshot();

    const response = await POST(createSnapshotRequest(archive));
    const result = (await response.json()) as HostedScanResponse;
    const expectedDigest = `sha256:${createHash("sha256")
      .update(archive)
      .digest("hex")}`;

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      `${JSON_MEDIA_TYPE}; charset=utf-8`
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Accept");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("ratelimit-limit")).toBe("10");
    expect(response.headers.get("ratelimit-remaining")).toBe("9");
    expect(result.schemaVersion).toBe(1);
    expect(result.scan).toMatchObject({
      resolvedRevision: null,
      sourceDigest: expectedDigest,
      status: "completed",
    });
    expect(result.scan.id).toMatch(SCAN_ID_PATTERN);
    expect(result.report.packageName).toBe("hosted-route-fixture");
    expect(result.report.source).toEqual({
      digest: expectedDigest,
      kind: "snapshot",
      revision: null,
    });
    expect(result.handoff.promptMarkdown).toContain("<shadscan-data");
    expect(result.handoff.promptMarkdown).toContain('"kind": "snapshot"');
  });

  it("returns the paste-ready prompt when Markdown is requested", async () => {
    const archive = await createMinimalReactSnapshot();

    const response = await POST(
      createSnapshotRequest(archive, { accept: MARKDOWN_MEDIA_TYPE })
    );
    const prompt = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      `${MARKDOWN_MEDIA_TYPE}; charset=utf-8`
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Accept");
    expect(prompt).toContain("You are improving a React shadcn application");
    expect(prompt).toContain("<shadscan-data");
    expect(prompt).toContain('"kind": "snapshot"');
  });

  it("returns the same prompt in JSON and negotiated Markdown", async () => {
    const archive = await createMinimalReactSnapshot();

    const jsonResponse = await POST(createSnapshotRequest(archive));
    const jsonResult = (await jsonResponse.json()) as HostedScanResponse;
    const markdownResponse = await POST(
      createSnapshotRequest(archive, { accept: MARKDOWN_MEDIA_TYPE })
    );

    expect(markdownResponse.status).toBe(200);
    await expect(markdownResponse.text()).resolves.toBe(
      jsonResult.handoff.promptMarkdown
    );
  });

  it("scans a selected category inside a snapshot subdirectory", async () => {
    const archive = await createTarGzip([
      {
        contents: FIXTURE_PACKAGE_JSON,
        header: { name: "apps/web/package.json", type: "file" },
      },
      {
        contents: FIXTURE_APP_SOURCE,
        header: { name: "apps/web/src/App.tsx", type: "file" },
      },
    ]);
    const response = await POST(
      createSnapshotRequest(
        archive,
        {},
        `${SCAN_URL}?subdirectory=apps/web&category=accessibility`
      )
    );
    const result = (await response.json()) as HostedScanResponse;

    expect(response.status).toBe(200);
    expect(result.report.packageName).toBe("hosted-route-fixture");
    expect(result.report.scope.categories).toEqual(["accessibility"]);
    expect(result.report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "accessibility" }),
      ])
    );
    expect(
      result.report.findings.every(
        (finding) => finding.category === "accessibility"
      )
    ).toBe(true);
  });

  it.each([
    {
      accept: "text/markdown;q=0, application/json;q=1",
      expectedMediaType: JSON_MEDIA_TYPE,
    },
    { accept: "application/*", expectedMediaType: JSON_MEDIA_TYPE },
    { accept: "text/*", expectedMediaType: MARKDOWN_MEDIA_TYPE },
    {
      accept: "text/markdown, application/json",
      expectedMediaType: MARKDOWN_MEDIA_TYPE,
    },
    {
      accept: "text/markdown;q=0, */*;q=0.5",
      expectedMediaType: JSON_MEDIA_TYPE,
    },
    { accept: "text/markdownish", expectedMediaType: null },
    { accept: "*/*;q=0", expectedMediaType: null },
  ])("negotiates an exact supported response for Accept: $accept", async ({
    accept,
    expectedMediaType,
  }) => {
    const archive = await createMinimalReactSnapshot();
    const request = createSnapshotRequest(archive, { accept });
    const response = await POST(request);

    if (expectedMediaType === null) {
      const result = (await response.json()) as HostedScanErrorBody;
      expect(response.status).toBe(406);
      expect(request.bodyUsed).toBe(false);
      expect(result.error.code).toBe("NOT_ACCEPTABLE");
      return;
    }

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      `${expectedMediaType}; charset=utf-8`
    );
  });

  it("keeps the hosted report in parity with the CLI for the same source", async () => {
    const projectDirectory = await mkdtemp(
      join(tmpdir(), "shadscan-cli-api-parity-")
    );

    try {
      await mkdir(join(projectDirectory, "src"));
      await Promise.all([
        writeFile(
          join(projectDirectory, "package.json"),
          FIXTURE_PACKAGE_JSON,
          "utf8"
        ),
        writeFile(
          join(projectDirectory, "src/App.tsx"),
          FIXTURE_APP_SOURCE,
          "utf8"
        ),
      ]);

      const archive = await createMinimalReactSnapshot();
      const response = await POST(createSnapshotRequest(archive));
      const hostedResult = (await response.json()) as HostedScanResponse;
      const { stdout } = await execFileAsync(
        process.execPath,
        [CLI_ENTRYPOINT, "--json", "--roast"],
        {
          cwd: projectDirectory,
          encoding: "utf8",
        }
      );
      const cliReport = JSON.parse(stdout) as AuditReport;

      expect(response.status).toBe(200);
      expect(withoutExecutionMetadata(hostedResult.report)).toEqual(
        withoutExecutionMetadata(cliReport)
      );
    } finally {
      await rm(projectDirectory, { force: true, recursive: true });
    }
  });

  it.each([
    { authorization: undefined, label: "missing" },
    { authorization: "Bearer invalid", label: "invalid" },
  ])("rejects $label authentication before reading the body", async ({
    authorization,
  }) => {
    const headers = new Headers({ "content-type": JSON_MEDIA_TYPE });
    if (authorization) {
      headers.set("authorization", authorization);
    }
    const request = new Request(SCAN_URL, {
      body: "{ definitely not valid JSON",
      headers,
      method: "POST",
    });

    const response = await POST(request);
    const result = (await response.json()) as HostedScanErrorBody;

    expect(response.status).toBe(401);
    expect(request.bodyUsed).toBe(false);
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer realm="shadscan"'
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Accept");
    expect(result).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "A valid Bearer API key is required.",
        retryable: false,
      },
      schemaVersion: 1,
    });
  });

  it("returns a stable error envelope for an unsupported request media type", async () => {
    const request = new Request(SCAN_URL, {
      body: "not a supported scan source",
      headers: {
        authorization: `Bearer ${PRIMARY_API_KEY}`,
        "content-type": "text/plain",
      },
      method: "POST",
    });

    const response = await POST(request);
    const result = (await response.json()) as HostedScanErrorBody;

    expect(response.status).toBe(415);
    expect(response.headers.get("content-type")).toBe(
      `${JSON_MEDIA_TYPE}; charset=utf-8`
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Accept");
    expect(result).toEqual({
      error: {
        code: "UNSUPPORTED_MEDIA_TYPE",
        message: `Expected Content-Type: ${JSON_MEDIA_TYPE} or ${SNAPSHOT_MEDIA_TYPE}.`,
        retryable: false,
      },
      schemaVersion: 1,
    });
  });

  it("returns a stable error envelope for a malformed snapshot archive", async () => {
    const response = await POST(
      createSnapshotRequest(Buffer.from("this is not a gzip archive"))
    );
    const result = (await response.json()) as HostedScanErrorBody;

    expect(response.status).toBe(422);
    expect(result).toEqual({
      error: {
        code: "MALFORMED_ARCHIVE",
        message: "The request body is not a valid gzip tar archive.",
        retryable: false,
      },
      schemaVersion: 1,
    });
  });

  it("returns a stable error envelope for conflicting snapshot paths", async () => {
    const archive = await createTarGzip([
      {
        contents: "ancestor",
        header: { name: "app", type: "file" },
      },
      {
        contents: "descendant",
        header: { name: "app/page.tsx", type: "file" },
      },
    ]);

    const response = await POST(createSnapshotRequest(archive));
    const result = (await response.json()) as HostedScanErrorBody;

    expect(response.status).toBe(422);
    expect(result).toEqual({
      error: {
        code: "ARCHIVE_PATH_CONFLICT",
        message: "The archive contains conflicting paths.",
        retryable: false,
      },
      schemaVersion: 1,
    });
  });

  it("returns a stable error envelope for invalid package metadata", async () => {
    const archive = await createTarGzip([
      {
        contents: "{ invalid JSON",
        header: { name: "package.json", type: "file" },
      },
    ]);

    const response = await POST(createSnapshotRequest(archive));
    const result = (await response.json()) as HostedScanErrorBody;

    expect(response.status).toBe(422);
    expect(result).toEqual({
      error: {
        code: "INVALID_PACKAGE_JSON",
        message:
          "The selected source root must contain a valid package.json object.",
        retryable: false,
      },
      schemaVersion: 1,
    });
  });

  it("classifies a GitHub response-body timeout as a retryable timeout", async () => {
    const responseBody = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.error(new DOMException("Timed out", "TimeoutError"));
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Response(responseBody, { status: 200 }))
    );

    const response = await POST(createGitHubRequest());
    const result = (await response.json()) as HostedScanErrorBody;

    expect(response.status).toBe(504);
    expect(result).toEqual({
      error: {
        code: "GITHUB_TIMEOUT",
        message: "GitHub did not respond before the source timeout.",
        retryable: true,
      },
      schemaVersion: 1,
    });
  });

  it("classifies empty GitHub metadata as a retryable upstream failure", async () => {
    const fetchMock = vi.fn(() => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(createGitHubRequest());
    const result = (await response.json()) as HostedScanErrorBody;

    expect(response.status).toBe(502);
    expect(result).toEqual({
      error: {
        code: "GITHUB_INVALID_RESPONSE",
        message: "GitHub returned an empty metadata response.",
        retryable: true,
      },
      schemaVersion: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("classifies an empty GitHub archive as a retryable upstream failure", async () => {
    const fetchMock = vi.fn((input: Parameters<typeof fetch>[0]): Response => {
      const url = getFetchUrl(input);
      if (url === "https://api.github.com/repos/acme/widget") {
        return Response.json({ private: false });
      }
      if (url === "https://api.github.com/repos/acme/widget/commits/main") {
        return Response.json({ sha: IMMUTABLE_COMMIT_SHA });
      }
      if (
        url ===
        `https://api.github.com/repos/acme/widget/tarball/${IMMUTABLE_COMMIT_SHA}`
      ) {
        return new Response(null, { status: 200 });
      }

      throw new Error(`Unexpected GitHub request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(createGitHubRequest());
    const result = (await response.json()) as HostedScanErrorBody;

    expect(response.status).toBe(502);
    expect(result).toEqual({
      error: {
        code: "GITHUB_INVALID_RESPONSE",
        message: "GitHub returned an empty source archive.",
        retryable: true,
      },
      schemaVersion: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns a stable error envelope before reading an oversized snapshot", async () => {
    const request = createSnapshotRequest(Buffer.from("x"), {
      "content-length": (MAX_SNAPSHOT_BYTES + 1).toString(),
    });

    const response = await POST(request);
    const result = (await response.json()) as HostedScanErrorBody;

    expect(response.status).toBe(413);
    expect(request.bodyUsed).toBe(false);
    expect(result).toEqual({
      error: {
        code: "SNAPSHOT_TOO_LARGE",
        message: "The snapshot exceeds the 4 MiB compressed size limit.",
        retryable: false,
      },
      schemaVersion: 1,
    });
  });

  it("returns a stable error envelope for a forbidden snapshot path", async () => {
    const archive = await createTarGzip([
      {
        contents: "SHOULD_NOT_BE_SCANNED=1\n",
        header: { name: ".env", type: "file" },
      },
      {
        contents: '{"name":"forbidden-fixture"}\n',
        header: { name: "package.json", type: "file" },
      },
    ]);

    const response = await POST(createSnapshotRequest(archive));
    const result = (await response.json()) as HostedScanErrorBody;

    expect(response.status).toBe(422);
    expect(result).toEqual({
      error: {
        code: "FORBIDDEN_SNAPSHOT_PATH",
        message:
          "The snapshot contains a secret or generated path that must be excluded.",
        retryable: false,
      },
      schemaVersion: 1,
    });
  });

  it("enforces the rate-limit boundary while isolating keys and reset windows", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T18:00:00.000Z"));

    for (let requestIndex = 0; requestIndex < 10; requestIndex += 1) {
      const response = await POST(createUnsupportedMediaRequest());
      expect(response.status).toBe(415);
    }

    const limitedResponse = await POST(createUnsupportedMediaRequest());
    const limitedResult = (await limitedResponse.json()) as HostedScanErrorBody;

    expect(limitedResponse.status).toBe(429);
    expect(limitedResponse.headers.get("ratelimit-limit")).toBe("10");
    expect(limitedResponse.headers.get("ratelimit-remaining")).toBe("0");
    expect(limitedResponse.headers.get("retry-after")).toBe("60");
    expect(limitedResult.error).toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
    });

    const isolatedKeyResponse = await POST(
      createUnsupportedMediaRequest(SECONDARY_API_KEY)
    );
    expect(isolatedKeyResponse.status).toBe(415);

    vi.advanceTimersByTime(60_001);
    const nextWindowResponse = await POST(createUnsupportedMediaRequest());
    expect(nextWindowResponse.status).toBe(415);

    resetMemoryRateLimits();
    const explicitlyResetResponse = await POST(createUnsupportedMediaRequest());
    expect(explicitlyResetResponse.status).toBe(415);
  });

  it("resolves a public GitHub revision to an immutable commit before scanning", async () => {
    process.env.GITHUB_TOKEN = "server-side-github-token";
    const archiveRoot = `acme-widget-${IMMUTABLE_COMMIT_SHA.slice(0, 7)}`;
    const archive = await createTarGzip([
      { header: { name: `${archiveRoot}/`, type: "directory" } },
      {
        contents: `${JSON.stringify({
          dependencies: { react: "19.2.4" },
          name: "github-route-fixture",
        })}\n`,
        header: { name: `${archiveRoot}/package.json`, type: "file" },
      },
      {
        contents: "export const App = () => <main>GitHub</main>;\n",
        header: { name: `${archiveRoot}/src/App.tsx`, type: "file" },
      },
    ]);
    const archiveUrl = `https://codeload.github.com/acme/widget/legacy.tar.gz/${IMMUTABLE_COMMIT_SHA}`;
    let sharedSourceSignal: AbortSignal | null | undefined;
    const fetchMock = vi.fn(
      (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1]
      ): Response => {
        const url = getFetchUrl(input);
        if (sharedSourceSignal === undefined) {
          sharedSourceSignal = init?.signal;
        } else {
          expect(init?.signal).toBe(sharedSourceSignal);
        }
        if (url === "https://api.github.com/repos/acme/widget") {
          expect(new Headers(init?.headers).get("authorization")).toBe(
            "Bearer server-side-github-token"
          );
          return Response.json({ private: false });
        }
        if (url === "https://api.github.com/repos/acme/widget/commits/main") {
          return Response.json({ sha: IMMUTABLE_COMMIT_SHA });
        }
        if (
          url ===
          `https://api.github.com/repos/acme/widget/tarball/${IMMUTABLE_COMMIT_SHA}`
        ) {
          return new Response(null, {
            headers: { location: archiveUrl },
            status: 302,
          });
        }
        if (url === archiveUrl) {
          expect(new Headers(init?.headers).has("authorization")).toBe(false);
          return new Response(new Blob([Uint8Array.from(archive)]));
        }

        throw new Error(`Unexpected GitHub request: ${url}`);
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(createGitHubRequest());
    const result = (await response.json()) as HostedScanResponse;
    const expectedDigest = `sha256:${createHash("sha256")
      .update(archive)
      .digest("hex")}`;

    expect(response.status).toBe(200);
    expect(result.scan).toMatchObject({
      resolvedRevision: IMMUTABLE_COMMIT_SHA,
      sourceDigest: expectedDigest,
      status: "completed",
    });
    expect(result.report.packageName).toBe("github-route-fixture");
    expect(result.report.source).toEqual({
      digest: expectedDigest,
      kind: "git",
      revision: IMMUTABLE_COMMIT_SHA,
    });
    expect(result.handoff.promptMarkdown).toContain(IMMUTABLE_COMMIT_SHA);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("rejects an unsafe GitHub archive redirect without fetching it", async () => {
    const fetchMock = vi.fn((input: Parameters<typeof fetch>[0]): Response => {
      const url = getFetchUrl(input);
      if (url === "https://api.github.com/repos/acme/widget") {
        return Response.json({ private: false });
      }
      if (url === "https://api.github.com/repos/acme/widget/commits/main") {
        return Response.json({ sha: IMMUTABLE_COMMIT_SHA });
      }
      if (
        url ===
        `https://api.github.com/repos/acme/widget/tarball/${IMMUTABLE_COMMIT_SHA}`
      ) {
        return Response.redirect("http://127.0.0.1/private-source.tar.gz", 302);
      }

      throw new Error(`Unsafe redirect was fetched: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(createGitHubRequest());
    const result = (await response.json()) as HostedScanErrorBody;

    expect(response.status).toBe(502);
    expect(result).toEqual({
      error: {
        code: "GITHUB_UNSAFE_REDIRECT",
        message: "GitHub returned an unsafe archive redirect.",
        retryable: false,
      },
      schemaVersion: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects a private GitHub repository before resolving its revision", async () => {
    const fetchMock = vi.fn((input: Parameters<typeof fetch>[0]): Response => {
      const url = getFetchUrl(input);
      if (url === "https://api.github.com/repos/acme/private-widget") {
        return Response.json({ private: true });
      }

      throw new Error(`Private repository follow-up was fetched: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(createGitHubRequest("acme/private-widget"));
    const result = (await response.json()) as HostedScanErrorBody;

    expect(response.status).toBe(422);
    expect(result).toEqual({
      error: {
        code: "PRIVATE_REPOSITORY_UNSUPPORTED",
        message: "Only public GitHub repositories are supported.",
        retryable: false,
      },
      schemaVersion: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
