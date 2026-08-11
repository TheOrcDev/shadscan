import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";

const PLAIN_SCORE_PATTERN =
  /Your shadscan score: \[[#-]{16}\] \d+\/100 \(Grade [A-F]\)/;

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(scriptDirectory, "..");
const packageManifest = JSON.parse(
  await readFile(path.join(packageDirectory, "package.json"), "utf8")
);
const temporaryRoot = await mkdtemp(
  path.join(tmpdir(), "shadscan packed smoke ")
);
const npmCacheDirectory = path.join(temporaryRoot, "npm cache");
let overflowFixtureServer;

const getOptionValue = (optionName) => {
  const optionIndex = process.argv.indexOf(optionName);

  if (optionIndex === -1) {
    return null;
  }

  const value = process.argv[optionIndex + 1];
  assert.ok(value, `Expected a value after ${optionName}.`);
  return value;
};

const run = async (command, args, { cwd, expectedExitCode = 0 } = {}) => {
  const result = await execa(command, args, {
    cwd,
    env: {
      CI: "1",
      NO_COLOR: "1",
      npm_config_cache: npmCacheDirectory,
    },
    reject: false,
  });

  assert.equal(
    result.exitCode,
    expectedExitCode,
    [
      `Expected ${command} ${args.join(" ")} to exit ${expectedExitCode}, received ${result.exitCode}.`,
      result.stdout,
      result.stderr,
    ]
      .filter(Boolean)
      .join("\n")
  );

  return result;
};

const startOverflowFixture = async () => {
  overflowFixtureServer = createServer((request, response) => {
    const requestUrl = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "127.0.0.1"}`
    );
    const isOverflow = requestUrl.pathname === "/overflow";
    const markup = isOverflow
      ? '<div data-slot="packed-overflow" style="height:1px;width:calc(100vw + 1px)"></div>'
      : "<main>Packed artifact fits</main>";

    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
    });
    response.end(
      `<!doctype html><html><head><style>html,body{margin:0;padding:0}</style><title>Packed overflow fixture</title></head><body>${markup}</body></html>`
    );
  });

  await new Promise((resolveListen, rejectListen) => {
    overflowFixtureServer.once("error", rejectListen);
    overflowFixtureServer.listen(0, "127.0.0.1", resolveListen);
  });

  const address = overflowFixtureServer.address();
  assert.ok(
    address && typeof address !== "string",
    "Expected the packed overflow fixture to bind to a TCP port."
  );
  return `http://127.0.0.1:${address.port}`;
};

const stopOverflowFixture = async () => {
  if (!overflowFixtureServer?.listening) {
    return;
  }

  await new Promise((resolveClose, rejectClose) => {
    overflowFixtureServer.close((error) => {
      if (error) {
        rejectClose(error);
        return;
      }
      resolveClose();
    });
  });
};

try {
  const packDirectory = path.join(temporaryRoot, "packed artifact");
  const consumerDirectory = path.join(temporaryRoot, "consumer project");
  await Promise.all([
    mkdir(packDirectory, { recursive: true }),
    mkdir(path.join(consumerDirectory, "src"), { recursive: true }),
  ]);

  const providedTarball = getOptionValue("--tarball");
  let tarballPath;

  if (providedTarball) {
    tarballPath = path.resolve(process.cwd(), providedTarball);
    assert.equal(
      path.extname(tarballPath),
      ".tgz",
      "Expected --tarball to reference an npm .tgz artifact."
    );
    await access(tarballPath);
  } else {
    await run(
      "npm",
      ["pack", "--ignore-scripts", "--pack-destination", packDirectory],
      { cwd: packageDirectory }
    );

    const tarballs = (await readdir(packDirectory)).filter((fileName) =>
      fileName.endsWith(".tgz")
    );
    assert.equal(tarballs.length, 1, "Expected exactly one packed tarball.");
    tarballPath = path.join(packDirectory, tarballs[0]);
  }
  const npxExecutable = process.platform === "win32" ? "npx.cmd" : "npx";

  const npxVersionResult = await run(
    npxExecutable,
    ["--yes", `--package=${tarballPath}`, "shadscan", "--version"],
    { cwd: packDirectory }
  );
  assert.equal(npxVersionResult.stdout.trim(), packageManifest.version);

  await writeFile(
    path.join(consumerDirectory, "package.json"),
    `${JSON.stringify({ name: "shadscan-smoke-consumer", private: true, type: "module" }, null, 2)}\n`
  );
  await run(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarballPath],
    { cwd: consumerDirectory }
  );

  const consumerManifestPath = path.join(consumerDirectory, "package.json");
  const consumerManifest = JSON.parse(
    await readFile(consumerManifestPath, "utf8")
  );
  consumerManifest.dependencies = {
    ...consumerManifest.dependencies,
    react: "19.2.4",
  };
  await writeFile(
    consumerManifestPath,
    `${JSON.stringify(consumerManifest, null, 2)}\n`
  );
  await writeFile(
    path.join(consumerDirectory, "src", "App.tsx"),
    'export const App = () => <button type="button">Delete</button>;\n'
  );

  const executable = path.join(
    consumerDirectory,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "shadscan.cmd" : "shadscan"
  );
  const versionResult = await run(executable, ["--version"], {
    cwd: consumerDirectory,
  });
  assert.equal(versionResult.stdout.trim(), packageManifest.version);

  const helpResult = await run(executable, ["--help"], {
    cwd: consumerDirectory,
  });
  assert.match(helpResult.stdout, /--apply/);
  assert.match(helpResult.stdout, /--agent <agent>/);
  assert.match(helpResult.stdout, /--check-ui <url>/);
  assert.ok(!helpResult.stdout.includes("--check-overflow"));
  assert.match(helpResult.stdout, /--no-interactive/);
  assert.match(helpResult.stdout, /setup/);

  const humanResult = await run(executable, ["--no-roast"], {
    cwd: consumerDirectory,
  });
  assert.match(humanResult.stdout, PLAIN_SCORE_PATTERN);
  assert.ok(!humanResult.stdout.includes("\u001B"));
  assert.ok(!humanResult.stderr.includes("What next?"));

  const jsonResult = await run(executable, ["--json"], {
    cwd: consumerDirectory,
  });
  const report = JSON.parse(jsonResult.stdout);
  assert.equal(report.engineVersion, packageManifest.version);
  assert.ok(Number.isInteger(report.schemaVersion));
  assert.ok(report.schemaVersion > 0);
  assert.ok(Array.isArray(report.agentHandoff.workItems));
  assert.equal(
    typeof report.agentHandoff.verification.shadscanCommand,
    "string"
  );
  assert.ok(Array.isArray(report.findings));
  assert.ok(report.score < 100);
  assert.ok(!jsonResult.stdout.includes(temporaryRoot));

  const explicitPathResult = await run(
    executable,
    [consumerDirectory, "--json"],
    { cwd: packDirectory }
  );
  assert.equal(
    JSON.parse(explicitPathResult.stdout).packageName,
    "shadscan-smoke-consumer"
  );

  const npxReportResult = await run(
    npxExecutable,
    [
      "--yes",
      `--package=${tarballPath}`,
      "shadscan",
      consumerDirectory,
      "--json",
    ],
    { cwd: packDirectory }
  );
  assert.equal(
    JSON.parse(npxReportResult.stdout).packageName,
    "shadscan-smoke-consumer"
  );

  const categoryResult = await run(
    executable,
    ["--json", "--category", "accessibility"],
    { cwd: consumerDirectory }
  );
  const categoryReport = JSON.parse(categoryResult.stdout);
  assert.deepEqual(categoryReport.scope.categories, ["accessibility"]);
  assert.ok(
    categoryReport.findings.every(
      (finding) => finding.category === "accessibility"
    )
  );

  const promptResult = await run(executable, ["--prompt"], {
    cwd: consumerDirectory,
  });
  assert.match(promptResult.stdout, /<shadscan-data/);
  assert.match(promptResult.stdout, /"acceptanceCriteria"/);
  assert.match(promptResult.stdout, /"promptVersion": 5/);
  assert.match(promptResult.stdout, /"workItems"/);

  const thresholdResult = await run(
    executable,
    ["--json", "--fail-under", "100"],
    { cwd: consumerDirectory, expectedExitCode: 1 }
  );
  assert.ok(JSON.parse(thresholdResult.stdout).score < 100);

  const invalidAgentResult = await run(executable, ["--agent", "codex"], {
    cwd: consumerDirectory,
    expectedExitCode: 1,
  });
  assert.match(invalidAgentResult.stderr, /--agent requires --apply/);

  const legacyOverflowAliasResult = await run(
    executable,
    ["--check-overflow", "not-a-url", "--json"],
    {
      cwd: consumerDirectory,
      expectedExitCode: 1,
    }
  );
  assert.equal(legacyOverflowAliasResult.stdout, "");
  assert.deepEqual(JSON.parse(legacyOverflowAliasResult.stderr).error, {
    code: "INVALID_ARGUMENTS",
    message: "The overflow target must be an absolute HTTP or HTTPS URL.",
  });

  const browserExecutable =
    getOptionValue("--browser-executable") ??
    process.env.SHADSCAN_SMOKE_BROWSER_EXECUTABLE;
  if (browserExecutable) {
    await access(browserExecutable);
    const overflowFixtureOrigin = await startOverflowFixture();
    const browserArguments = [
      "--browser-executable",
      browserExecutable,
      "--json",
      "--no-interactive",
    ];
    const fittingOverflowResult = await run(
      executable,
      ["--check-ui", `${overflowFixtureOrigin}/fits`, ...browserArguments],
      { cwd: consumerDirectory }
    );
    assert.equal(fittingOverflowResult.stderr, "");
    assert.deepEqual(
      {
        status: JSON.parse(fittingOverflowResult.stdout).status,
        summary: JSON.parse(fittingOverflowResult.stdout).summary,
      },
      {
        status: "pass",
        summary: { failed: 0, maximumOverflowPx: 0, measurements: 2 },
      }
    );

    const failingOverflowResult = await run(
      executable,
      ["--check-ui", `${overflowFixtureOrigin}/overflow`, ...browserArguments],
      { cwd: consumerDirectory, expectedExitCode: 1 }
    );
    assert.equal(failingOverflowResult.stderr, "");
    assert.deepEqual(
      {
        status: JSON.parse(failingOverflowResult.stdout).status,
        summary: JSON.parse(failingOverflowResult.stdout).summary,
      },
      {
        status: "fail",
        summary: { failed: 2, maximumOverflowPx: 1, measurements: 2 },
      }
    );
  }

  const setupPreviewResult = await run(
    executable,
    ["setup", "--pre-commit", "--dry-run"],
    { cwd: consumerDirectory }
  );
  assert.match(setupPreviewResult.stdout, /Shadscan pre-commit plan/);
  assert.match(setupPreviewResult.stdout, /Mode: manual/);

  const importCheckPath = path.join(consumerDirectory, "verify-import.mjs");
  await writeFile(
    importCheckPath,
    [
      'import { AUDIT_REPORT_SCHEMA_VERSION, RULE_CATALOG, scanProject } from "@shadscan/cli";',
      `if (AUDIT_REPORT_SCHEMA_VERSION !== ${JSON.stringify(report.schemaVersion)} || RULE_CATALOG.length !== 62 || typeof scanProject !== "function") {`,
      '  throw new Error("The installed library exports are incomplete.");',
      "}",
      "",
    ].join("\n")
  );
  await run(process.execPath, [importCheckPath], { cwd: consumerDirectory });

  // --- MCP bundle audit -----------------------------------------------------
  // The MCP SDK is a bundled devDependency; its HTTP transports (express,
  // hono, and friends) must never reach the shipped bundle. Import
  // specifiers surviving in dist/cli.js would mean esbuild left them
  // external — a runtime crash for users; their absence plus the size guard
  // means they were neither imported nor inlined.
  const bundlePath = path.join(
    consumerDirectory,
    "node_modules",
    "@shadscan",
    "cli",
    "dist",
    "cli.js"
  );
  const bundle = await readFile(bundlePath, "utf8");
  const forbiddenSpecifiers = [
    "express",
    "hono",
    "@hono/node-server",
    "cors",
    "jose",
    "eventsource",
    "express-rate-limit",
    "raw-body",
    "pkce-challenge",
  ];
  for (const specifier of forbiddenSpecifiers) {
    const importPattern = new RegExp(
      `(?:from\\s*|require\\()["']${specifier.replace("/", "\\/")}["']`
    );
    assert.ok(
      !importPattern.test(bundle),
      `dist/cli.js references "${specifier}"; the MCP HTTP stack leaked into the bundle.`
    );
  }
  const bundleBytes = Buffer.byteLength(bundle);
  assert.ok(
    bundleBytes < 2_500_000,
    `dist/cli.js is ${bundleBytes} bytes; expected the stdio-only MCP bundle to stay under 2.5MB.`
  );

  // --- MCP stdio roundtrip --------------------------------------------------
  // Drive the packed binary end to end over real stdio: initialize,
  // tools/list, then a scan of the consumer project. Every stdout line must
  // parse as JSON — one stray write corrupts the protocol.
  const mcpMessages = [
    {
      id: 1,
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        capabilities: {},
        clientInfo: { name: "smoke", version: "0.0.0" },
        protocolVersion: "2025-06-18",
      },
    },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { id: 2, jsonrpc: "2.0", method: "tools/list" },
    {
      id: 3,
      jsonrpc: "2.0",
      method: "tools/call",
      params: { arguments: {}, name: "scan" },
    },
  ];
  const mcpResult = await execa(executable, ["mcp", consumerDirectory], {
    cwd: consumerDirectory,
    env: { CI: "1", NO_COLOR: "1", npm_config_cache: npmCacheDirectory },
    input: `${mcpMessages.map((message) => JSON.stringify(message)).join("\n")}\n`,
    reject: false,
    timeout: 120_000,
  });
  const mcpLines = mcpResult.stdout.split("\n").filter(Boolean);
  assert.ok(mcpLines.length >= 3, "Expected three JSON-RPC responses.");
  const mcpParsed = [];
  for (const line of mcpLines) {
    try {
      mcpParsed.push(JSON.parse(line));
    } catch {
      assert.fail(
        `Non-JSON output on the MCP stdout stream: ${line.slice(0, 120)}`
      );
    }
  }
  const toolsListResponse = mcpParsed.find((message) => message.id === 2);
  assert.ok(toolsListResponse, "Missing tools/list response.");
  assert.deepEqual(
    toolsListResponse.result.tools.map((tool) => tool.name).sort(),
    ["explain_rule", "list_projects", "scan"]
  );
  const scanResponse = mcpParsed.find((message) => message.id === 3);
  assert.ok(scanResponse, "Missing scan response.");
  const scanPayload = JSON.parse(scanResponse.result.content[0].text);
  assert.equal(scanPayload.engineVersion, packageManifest.version);
  assert.ok(Number.isInteger(scanPayload.score));
  assert.ok(Array.isArray(scanPayload.actionables));

  const overflowSummary = browserExecutable ? ", browser overflow" : "";
  process.stdout.write(
    `Packed shadscan ${packageManifest.version} passed npx, install, bin, output, threshold, import${overflowSummary}, MCP bundle-audit, and MCP stdio smoke tests.\n`
  );
} finally {
  try {
    await stopOverflowFixture();
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}
