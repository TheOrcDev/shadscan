import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, test } from "@playwright/test";

const CLI_ENTRYPOINT = resolve("packages/cli/dist/cli.js");
const COMMAND_TIMEOUT_MS = 40_000;

interface CliResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

interface OverflowMeasurement {
  clientWidth: number;
  culprits: Array<{
    descriptor: string;
  }>;
  finalPath: string;
  forcedScrollbar: boolean;
  httpStatus: number;
  overflowPx: number;
  page: string;
  scrollWidth: number;
  status: "fail" | "pass";
  viewport: {
    height: number;
    name: "desktop" | "mobile";
    width: number;
  };
}

interface OverflowReport {
  durationMs: number;
  kind: "overflow-check";
  results: OverflowMeasurement[];
  schemaVersion: 1;
  severity: "critical";
  status: "fail" | "pass";
  summary: {
    failed: number;
    maximumOverflowPx: number;
    measurements: number;
  };
  target: {
    origin: string;
    pages: string[];
  };
}

interface CliProcessError extends Error {
  code?: number | string | null;
  killed?: boolean;
  stderr?: string;
  stdout?: string;
}

const fixtureMarkup = (pathname: string): string | null => {
  const sharedStyles =
    "html,body{margin:0;min-height:100%;padding:0}*{box-sizing:border-box}";

  if (pathname === "/fits") {
    return `<style>${sharedStyles}</style><main data-slot="fits">Fits</main>`;
  }

  if (pathname === "/local-scroller") {
    return `<style>${sharedStyles}</style><div data-slot="local-scroller" style="max-width:100%;overflow-x:auto"><div style="width:640px">Contained overflow</div></div>`;
  }

  if (pathname === "/subpixel") {
    return `<style>${sharedStyles}</style><div data-slot="subpixel" style="width:320.49px">Rounded without a scroll range</div>`;
  }

  if (pathname === "/vertical-only") {
    return `<style>${sharedStyles}body{min-height:2000px}</style><main>Vertical scrolling only</main>`;
  }

  if (pathname === "/delayed-fit") {
    return `<style>${sharedStyles}</style><div data-slot="delayed-fit" style="width:calc(100vw + 1px)">Settling</div><script>setTimeout(()=>{document.querySelector('[data-slot="delayed-fit"]').style.width='100%'},1000)</script>`;
  }

  if (pathname === "/delayed-font-ready") {
    return `<style>${sharedStyles}</style><div data-slot="font-layout" style="width:calc(100vw + 1px)">Loading font layout</div><script>const layout=document.querySelector('[data-slot="font-layout"]');const ready=new Promise((resolve)=>setTimeout(()=>{layout.style.width='100%';resolve()},1400));Object.defineProperty(document,'fonts',{configurable:true,value:{ready}})</script>`;
  }

  if (pathname === "/unstable-width") {
    return `<style>${sharedStyles}</style><div data-slot="unstable-width" style="height:1px;width:100vw"></div><script>const unstable=document.querySelector('[data-slot="unstable-width"]');let extraWidth=0;setInterval(()=>{extraWidth+=1;unstable.style.width='calc(100vw + '+extraWidth+'px)'},25)</script>`;
  }

  if (pathname === "/motion-overflow") {
    return `<style>${sharedStyles}[data-slot="motion-overflow"]{height:1px;width:calc(100vw + 1px)}@media(prefers-reduced-motion:reduce){[data-slot="motion-overflow"]{width:100%}}</style><div data-slot="motion-overflow"></div>`;
  }

  if (pathname === "/hash-overflow") {
    return `<style>${sharedStyles}body{position:relative}[data-slot="normal"]{height:1px;width:100%}#target{height:1px;left:1000px;position:absolute;width:1px}</style><div data-slot="normal"></div><div id="target"></div>`;
  }

  if (pathname === "/many-culprits") {
    return `<style>${sharedStyles}.culprit{height:1px;width:calc(100vw + 1px)}</style>${'<div class="culprit"></div>'.repeat(20_000)}`;
  }

  if (pathname === "/client-redirect") {
    return `<style>${sharedStyles}</style><main>Redirecting</main><script>setTimeout(()=>location.replace('https://example.invalid/private?token=must-not-leak'),100)</script>`;
  }

  if (pathname === "/client-404") {
    return `<style>${sharedStyles}</style><main>Redirecting</main><script>setTimeout(()=>location.replace('/missing'),100)</script>`;
  }

  if (pathname === "/immediate-404") {
    return `<style>${sharedStyles}</style><main>Redirecting</main><script>location.replace('/missing')</script>`;
  }

  if (pathname === "/client-blob") {
    return `<style>${sharedStyles}</style><main>Redirecting</main><script>const blobUrl=URL.createObjectURL(new Blob(['<!doctype html><title>Blob page</title>'],{type:'text/html'}));setTimeout(()=>location.replace(blobUrl),100)</script>`;
  }

  if (pathname === "/one-pixel") {
    return `<style>${sharedStyles}@media(max-width:400px){[data-slot="one-pixel"]{width:321px}}</style><div data-slot="one-pixel">One pixel wider on mobile</div>`;
  }

  if (pathname === "/forced-scrollbar") {
    return `<style>${sharedStyles}html{overflow-x:scroll}</style><main>Forced scrollbar</main>`;
  }

  if (pathname === "/translated") {
    return `<style>${sharedStyles}</style><div data-slot="translated" style="height:1px;transform:translateX(1px);width:100vw"></div>`;
  }

  if (pathname === "/absolute") {
    return `<style>${sharedStyles}body{position:relative}</style><div data-slot="absolute" style="height:1px;left:100%;position:absolute;width:1px"></div>`;
  }

  if (pathname === "/pseudo") {
    return `<style>${sharedStyles}body{position:relative}body::after{content:"";height:1px;left:100%;position:absolute;width:1px}</style><main>Pseudo-element overflow</main>`;
  }

  if (pathname === "/svg") {
    return `<style>${sharedStyles}svg{display:block;width:100%}@media(min-width:1000px){svg{width:calc(100vw + 1px)}}</style><svg data-slot="wide-svg" height="1"></svg>`;
  }

  if (pathname === "/rtl-left") {
    return `<style>${sharedStyles}html{direction:rtl}body{position:relative}</style><div data-slot="rtl-left" style="height:1px;position:absolute;right:100%;width:1px"></div>`;
  }

  if (pathname === "/root-hidden") {
    return `<style>${sharedStyles}html{overflow-x:hidden}</style><div data-slot="hidden-overflow" style="height:1px;width:calc(100vw + 1px)"></div>`;
  }

  if (pathname === "/root-clip") {
    return `<style>${sharedStyles}html{overflow-x:clip}</style><div data-slot="clipped-overflow" style="height:1px;width:calc(100vw + 1px)"></div>`;
  }

  if (pathname === "/open-shadow-root") {
    return `<style>${sharedStyles}</style><div data-slot="shadow-host"></div><script>const host=document.querySelector('[data-slot="shadow-host"]');const shadow=host.attachShadow({mode:'open'});shadow.innerHTML='<div data-slot="shadow-overflow" style="height:1px;width:calc(100vw + 1px)"></div>'</script>`;
  }

  return null;
};

const runOverflowCheck = async (arguments_: string[]): Promise<CliResult> => {
  try {
    const result = await new Promise<{ stderr: string; stdout: string }>(
      (resolveResult, rejectResult) => {
        execFile(
          process.execPath,
          [CLI_ENTRYPOINT, ...arguments_],
          {
            cwd: emptyWorkingDirectory,
            encoding: "utf8",
            env: {
              ...process.env,
              CI: "1",
              FORCE_COLOR: undefined,
              NO_COLOR: "1",
              SHADSCAN_INTERACTIVE: "0",
            },
            maxBuffer: 1_000_000,
            timeout: COMMAND_TIMEOUT_MS,
          },
          (error, stdout, stderr) => {
            if (error) {
              const processError = error as CliProcessError;
              processError.stdout = stdout;
              processError.stderr = stderr;
              rejectResult(processError);
              return;
            }

            resolveResult({ stderr, stdout });
          }
        );
      }
    );

    return { exitCode: 0, ...result };
  } catch (error) {
    const processError = error as CliProcessError;

    if (processError.killed || typeof processError.code !== "number") {
      throw error;
    }

    return {
      exitCode: processError.code,
      stderr: processError.stderr ?? "",
      stdout: processError.stdout ?? "",
    };
  }
};

let fixtureServer: Server | undefined;
let crossOriginServer: Server | undefined;
let fixtureOrigin = "";
let crossOrigin = "";
let canonicalOrigin = "";
let canonicalWwwOrigin = "";
const canonicalRequests: Array<{ host: string; pathname: string }> = [];
let crossOriginRequests = 0;
let clientHopCanonicalRequests = 0;
let clientReloadCanonicalRequests = 0;
let emptyWorkingDirectory = "";

const listenOnEphemeralPort = async (
  server: Server,
  description: string
): Promise<string> => {
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error(`${description} did not bind to a TCP port.`);
  }

  return `http://127.0.0.1:${address.port}`;
};

const closeServer = async (server: Server | undefined): Promise<void> => {
  if (!server) {
    return;
  }

  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) {
        rejectClose(error);
        return;
      }
      resolveClose();
    });
  });
};

test.beforeAll(async () => {
  emptyWorkingDirectory = await mkdtemp(
    join(tmpdir(), "shadscan-overflow-e2e-")
  );
  crossOriginServer = createServer((_request, response) => {
    crossOriginRequests += 1;
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
    });
    response.end(
      "<!doctype html><html><head><title>Cross origin</title></head><body><main>Cross origin target</main></body></html>"
    );
  });
  crossOrigin = await listenOnEphemeralPort(
    crossOriginServer,
    "The cross-origin overflow fixture server"
  );
  fixtureServer = createServer((request, response) => {
    const requestUrl = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "127.0.0.1"}`
    );

    if (
      requestUrl.pathname === "/redirect-canonical" ||
      requestUrl.pathname === "/fits" ||
      requestUrl.pathname === "/vertical-only"
    ) {
      canonicalRequests.push({
        host: request.headers.host ?? "",
        pathname: requestUrl.pathname,
      });
    }

    if (requestUrl.pathname === "/redirect-canonical") {
      response.writeHead(308, {
        "cache-control": "no-store",
        location: `${canonicalWwwOrigin}/fits?redirected=private#result`,
      });
      response.end();
      return;
    }

    if (requestUrl.pathname === "/redirect-canonical-third") {
      response.writeHead(308, {
        "cache-control": "no-store",
        location: `${canonicalWwwOrigin}/redirect-third`,
      });
      response.end();
      return;
    }

    if (requestUrl.pathname === "/redirect-third") {
      response.writeHead(302, {
        "cache-control": "no-store",
        location: `${crossOrigin}/fits?token=must-not-leak#private`,
      });
      response.end();
      return;
    }

    if (requestUrl.pathname === "/client-canonical") {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
      });
      response.end(
        `<!doctype html><html><head><title>Fixture</title></head><body><main>Redirecting</main><script>setTimeout(()=>location.replace('${canonicalWwwOrigin}/fits?token=must-not-leak#private'),100)</script></body></html>`
      );
      return;
    }

    if (requestUrl.pathname === "/client-hop-canonical") {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
      });
      response.end(
        "<!doctype html><html><head><title>Fixture</title></head><body><main>Redirecting</main><script>location.replace('/client-hop-bounce?token=client-hop-secret')</script></body></html>"
      );
      return;
    }

    if (requestUrl.pathname === "/client-hop-bounce") {
      response.writeHead(302, {
        "cache-control": "no-store",
        location: `${canonicalWwwOrigin}/client-hop-sink?token=client-hop-secret`,
      });
      response.end();
      return;
    }

    if (requestUrl.pathname === "/client-hop-sink") {
      clientHopCanonicalRequests += 1;
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
      });
      response.end(
        "<!doctype html><html><head><title>Fixture</title></head><body><main>Canonical sink</main></body></html>"
      );
      return;
    }

    if (requestUrl.pathname === "/client-reload-canonical") {
      const hasReloadCookie = (request.headers.cookie ?? "")
        .split(";")
        .some((cookie) => cookie.trim() === "shadscan_client_reload=1");
      if (hasReloadCookie) {
        response.writeHead(302, {
          "cache-control": "no-store",
          location: `${canonicalWwwOrigin}/client-reload-sink?token=client-reload-secret`,
        });
        response.end();
        return;
      }

      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
        "set-cookie": "shadscan_client_reload=1; Path=/; SameSite=Lax",
      });
      response.end(
        "<!doctype html><html><head><title>Fixture</title></head><body><main>Reloading</main><script>location.replace(location.href)</script></body></html>"
      );
      return;
    }

    if (requestUrl.pathname === "/client-reload-sink") {
      clientReloadCanonicalRequests += 1;
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
      });
      response.end(
        "<!doctype html><html><head><title>Fixture</title></head><body><main>Canonical reload sink</main></body></html>"
      );
      return;
    }

    if (requestUrl.pathname === "/redirect-same") {
      response.writeHead(302, {
        "cache-control": "no-store",
        location: "/fits?redirected=private#result",
      });
      response.end();
      return;
    }

    if (requestUrl.pathname === "/redirect-cross") {
      response.writeHead(302, {
        "cache-control": "no-store",
        location: `${crossOrigin}/fits?token=must-not-leak#private`,
      });
      response.end();
      return;
    }

    if (requestUrl.pathname === "/plain-text") {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
      });
      response.end("Successful status, wrong content type");
      return;
    }

    const markup = fixtureMarkup(requestUrl.pathname);

    if (markup === null) {
      response.writeHead(404, {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
      });
      response.end("<!doctype html><title>Missing</title><p>Not found</p>");
      return;
    }

    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
    });
    response.end(
      `<!doctype html><html><head><title>Fixture</title></head><body>${markup}</body></html>`
    );
  });
  fixtureOrigin = await listenOnEphemeralPort(
    fixtureServer,
    "The overflow fixture server"
  );
  const fixturePort = new URL(fixtureOrigin).port;
  canonicalOrigin = `http://localhost:${fixturePort}`;
  canonicalWwwOrigin = `http://www.localhost:${fixturePort}`;
});

test.afterAll(async () => {
  try {
    await Promise.all([
      closeServer(fixtureServer),
      closeServer(crossOriginServer),
    ]);
  } finally {
    if (emptyWorkingDirectory !== "") {
      await rm(emptyWorkingDirectory, { force: true, recursive: true });
    }
  }
});

test("passes fitting, contained, subpixel, vertical, and settled layouts", async () => {
  const secret = "must-not-appear";
  const result = await runOverflowCheck([
    "--check-ui",
    `${fixtureOrigin}/fits?token=${secret}#private`,
    "--route",
    "/local-scroller",
    "--route",
    "/subpixel",
    "--route",
    "/vertical-only",
    "--route",
    "/delayed-fit",
    "--browser-executable",
    chromium.executablePath(),
    "--json",
    "--no-interactive",
  ]);

  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
  expect(result.stdout).not.toContain(secret);

  const report = JSON.parse(result.stdout) as OverflowReport;
  expect(report).toMatchObject({
    kind: "overflow-check",
    schemaVersion: 1,
    severity: "critical",
    status: "pass",
    summary: {
      failed: 0,
      maximumOverflowPx: 0,
      measurements: 10,
    },
  });
  const mobileMeasurements = report.results.filter(
    ({ viewport }) => viewport.name === "mobile"
  );
  const desktopMeasurements = report.results.filter(
    ({ viewport }) => viewport.name === "desktop"
  );
  expect(mobileMeasurements).toHaveLength(5);
  expect(desktopMeasurements).toHaveLength(5);
  expect(
    mobileMeasurements.every(
      ({ viewport }) => viewport.width === 320 && viewport.height === 820
    )
  ).toBe(true);
  expect(
    desktopMeasurements.every(
      ({ viewport }) => viewport.width === 1440 && viewport.height === 1000
    )
  ).toBe(true);
});

test("detects document overflow across layout and rendering mechanisms", async () => {
  const result = await runOverflowCheck([
    "--check-ui",
    `${fixtureOrigin}/one-pixel`,
    "--route",
    "/forced-scrollbar",
    "--route",
    "/translated",
    "--route",
    "/absolute",
    "--route",
    "/pseudo",
    "--route",
    "/svg",
    "--route",
    "/rtl-left",
    "--route",
    "/root-hidden",
    "--route",
    "/root-clip",
    "--route",
    "/open-shadow-root",
    "--browser-executable",
    chromium.executablePath(),
    "--json",
    "--no-interactive",
  ]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toBe("");

  const report = JSON.parse(result.stdout) as OverflowReport;
  expect(report).toMatchObject({
    kind: "overflow-check",
    schemaVersion: 1,
    severity: "critical",
    status: "fail",
    summary: {
      failed: 18,
      maximumOverflowPx: 1,
      measurements: 20,
    },
  });

  const onePixelMobile = report.results.find(
    ({ page, viewport }) => page === "/one-pixel" && viewport.name === "mobile"
  );
  expect(onePixelMobile).toMatchObject({
    clientWidth: 320,
    overflowPx: 1,
    scrollWidth: 321,
    status: "fail",
  });

  const onePixelDesktop = report.results.find(
    ({ page, viewport }) => page === "/one-pixel" && viewport.name === "desktop"
  );
  expect(onePixelDesktop).toMatchObject({
    overflowPx: 0,
    status: "pass",
  });

  const forcedMeasurements = report.results.filter(
    ({ page }) => page === "/forced-scrollbar"
  );
  expect(forcedMeasurements).toHaveLength(2);
  expect(
    forcedMeasurements.every(
      ({ forcedScrollbar, status }) => forcedScrollbar && status === "fail"
    )
  ).toBe(true);

  const desktopSvg = report.results.find(
    ({ page, viewport }) => page === "/svg" && viewport.name === "desktop"
  );
  const mobileSvg = report.results.find(
    ({ page, viewport }) => page === "/svg" && viewport.name === "mobile"
  );
  expect(desktopSvg).toMatchObject({ overflowPx: 1, status: "fail" });
  expect(mobileSvg).toMatchObject({ overflowPx: 0, status: "pass" });

  for (const page of [
    "/translated",
    "/absolute",
    "/pseudo",
    "/rtl-left",
    "/root-hidden",
    "/root-clip",
    "/open-shadow-root",
  ]) {
    expect(
      report.results
        .filter((measurement) => measurement.page === page)
        .every((measurement) => measurement.status === "fail")
    ).toBe(true);
  }

  const shadowMeasurements = report.results.filter(
    ({ page }) => page === "/open-shadow-root"
  );
  expect(
    shadowMeasurements.every(({ culprits }) =>
      culprits.some(
        ({ descriptor }) => descriptor === '[data-slot="shadow-overflow"]'
      )
    )
  ).toBe(true);
});

test("measures the default motion profile and document coordinates", async () => {
  const result = await runOverflowCheck([
    "--check-ui",
    `${fixtureOrigin}/hash-overflow#target`,
    "--route",
    "/motion-overflow",
    "--route",
    "/many-culprits",
    "--browser-executable",
    chromium.executablePath(),
    "--json",
    "--no-interactive",
  ]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toMatchObject({
    status: "fail",
    summary: {
      failed: 5,
      maximumOverflowPx: 681,
      measurements: 6,
    },
  });
  const report = JSON.parse(result.stdout) as OverflowReport;
  const hashMobile = report.results.find(
    ({ page, viewport }) =>
      page === "/hash-overflow#[redacted]" && viewport.name === "mobile"
  );
  expect(hashMobile?.culprits[0]?.descriptor).toBe("#target");
  const manyCulpritMeasurements = report.results.filter(
    ({ page }) => page === "/many-culprits"
  );
  expect(manyCulpritMeasurements).toHaveLength(2);
  expect(
    manyCulpritMeasurements.every(({ culprits }) => culprits.length === 3)
  ).toBe(true);
});

test("waits for fonts and follows a same-origin HTTP redirect", async () => {
  const result = await runOverflowCheck([
    "--check-ui",
    `${fixtureOrigin}/redirect-same`,
    "--route",
    "/delayed-font-ready",
    "--browser-executable",
    chromium.executablePath(),
    "--json",
    "--no-interactive",
  ]);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).not.toContain("redirected=private");
  const report = JSON.parse(result.stdout) as OverflowReport;
  expect(report).toMatchObject({
    status: "pass",
    summary: { failed: 0, maximumOverflowPx: 0, measurements: 4 },
  });
  expect(report.durationMs).toBeGreaterThanOrEqual(1400);
  expect(
    report.results
      .filter(({ page }) => page === "/redirect-same")
      .every(
        ({ finalPath, httpStatus, status }) =>
          finalPath === "/fits" && httpStatus === 200 && status === "pass"
      )
  ).toBe(true);
  expect(
    report.results
      .filter(({ page }) => page === "/delayed-font-ready")
      .every(({ status }) => status === "pass")
  ).toBe(true);
});

test("follows a canonical server redirect and pins later routes", async () => {
  canonicalRequests.length = 0;
  const result = await runOverflowCheck([
    "--check-ui",
    `${canonicalOrigin}/redirect-canonical?token=must-not-leak#private`,
    "--route",
    "/vertical-only",
    "--browser-executable",
    chromium.executablePath(),
    "--json",
    "--no-interactive",
  ]);

  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
  expect(result.stdout).not.toContain("must-not-leak");

  const report = JSON.parse(result.stdout) as OverflowReport;
  expect(report).toMatchObject({
    status: "pass",
    summary: { failed: 0, maximumOverflowPx: 0, measurements: 4 },
    target: { origin: canonicalWwwOrigin },
  });
  expect(
    report.results.every(
      ({ httpStatus, status }) => httpStatus === 200 && status === "pass"
    )
  ).toBe(true);
  expect(
    report.results
      .filter(
        ({ page }) => page === "/redirect-canonical?[redacted]#[redacted]"
      )
      .every(({ finalPath }) => finalPath === "/fits")
  ).toBe(true);

  const canonicalHost = new URL(canonicalOrigin).host;
  const canonicalWwwHost = new URL(canonicalWwwOrigin).host;
  expect(
    canonicalRequests.filter(
      ({ host, pathname }) =>
        host === canonicalHost && pathname === "/redirect-canonical"
    )
  ).toHaveLength(2);
  expect(
    canonicalRequests.filter(
      ({ host, pathname }) =>
        host === canonicalWwwHost && pathname === "/vertical-only"
    )
  ).toHaveLength(2);
});

test("canonical navigation provenance rejects a client-side host alias", async () => {
  canonicalRequests.length = 0;
  const result = await runOverflowCheck([
    "--check-ui",
    `${canonicalOrigin}/client-canonical`,
    "--browser-executable",
    chromium.executablePath(),
    "--json",
    "--no-interactive",
  ]);

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).not.toContain("must-not-leak");
  expect(JSON.parse(result.stderr)).toMatchObject({
    error: {
      code: "OVERFLOW_TARGET_UNAVAILABLE",
    },
    schemaVersion: 1,
  });
  expect(
    canonicalRequests.filter(
      ({ host, pathname }) =>
        host === new URL(canonicalWwwOrigin).host && pathname === "/fits"
    )
  ).toHaveLength(0);
});

test("canonical navigation provenance rejects an alias after a client-side same-origin hop", async () => {
  clientHopCanonicalRequests = 0;
  const result = await runOverflowCheck([
    "--check-ui",
    `${canonicalOrigin}/client-hop-canonical`,
    "--browser-executable",
    chromium.executablePath(),
    "--json",
    "--no-interactive",
  ]);

  expect(
    clientHopCanonicalRequests,
    "the canonical destination must be blocked before network egress"
  ).toBe(0);
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).not.toContain("client-hop-secret");
  expect(JSON.parse(result.stderr)).toMatchObject({
    error: {
      code: "OVERFLOW_TARGET_UNAVAILABLE",
    },
    schemaVersion: 1,
  });
});

test("canonical navigation provenance rejects an alias after a client-side same-URL reload", async () => {
  clientReloadCanonicalRequests = 0;
  const result = await runOverflowCheck([
    "--check-ui",
    `${canonicalOrigin}/client-reload-canonical?token=client-reload-secret`,
    "--browser-executable",
    chromium.executablePath(),
    "--json",
    "--no-interactive",
  ]);

  expect(
    clientReloadCanonicalRequests,
    "the canonical destination must be blocked before network egress"
  ).toBe(0);
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).not.toContain("client-reload-secret");
  expect(JSON.parse(result.stderr)).toMatchObject({
    error: {
      code: "OVERFLOW_TARGET_UNAVAILABLE",
    },
    schemaVersion: 1,
  });
});

test("canonical navigation provenance rejects a third-origin server hop", async () => {
  crossOriginRequests = 0;
  const result = await runOverflowCheck([
    "--check-ui",
    `${canonicalOrigin}/redirect-canonical-third`,
    "--browser-executable",
    chromium.executablePath(),
    "--json",
    "--no-interactive",
  ]);

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).not.toContain("must-not-leak");
  expect(JSON.parse(result.stderr)).toMatchObject({
    error: {
      code: "OVERFLOW_TARGET_UNAVAILABLE",
    },
    schemaVersion: 1,
  });
  expect(crossOriginRequests).toBe(0);
});

test("canonical origin pin rejects a later route that leaves the origin", async () => {
  crossOriginRequests = 0;
  const result = await runOverflowCheck([
    "--check-ui",
    `${canonicalOrigin}/redirect-canonical`,
    "--route",
    "/redirect-cross",
    "--browser-executable",
    chromium.executablePath(),
    "--json",
    "--no-interactive",
  ]);

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).not.toContain("must-not-leak");
  expect(JSON.parse(result.stderr)).toMatchObject({
    error: {
      code: "OVERFLOW_TARGET_UNAVAILABLE",
    },
    schemaVersion: 1,
  });
  expect(crossOriginRequests).toBe(0);
});

test("rejects unstable, cross-origin, non-HTML, and unavailable targets", async () => {
  const cases = [
    {
      expectedCode: "OVERFLOW_PAGE_NOT_STABLE",
      expectedSecret: null,
      target: `${fixtureOrigin}/unstable-width`,
    },
    {
      expectedCode: "OVERFLOW_TARGET_UNAVAILABLE",
      expectedSecret: "must-not-leak",
      target: `${fixtureOrigin}/redirect-cross`,
    },
    {
      expectedCode: "OVERFLOW_TARGET_UNAVAILABLE",
      expectedSecret: null,
      target: `${fixtureOrigin}/plain-text`,
    },
    {
      expectedCode: "OVERFLOW_TARGET_UNAVAILABLE",
      expectedSecret: null,
      target: "http://127.0.0.1:1/unavailable",
    },
  ];

  for (const { expectedCode, expectedSecret, target } of cases) {
    const result = await runOverflowCheck([
      "--check-ui",
      target,
      "--browser-executable",
      chromium.executablePath(),
      "--json",
      "--no-interactive",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    if (expectedSecret) {
      expect(result.stderr).not.toContain(expectedSecret);
    }
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: { code: expectedCode },
      schemaVersion: 1,
    });
  }
});

test("keeps operational failures off stdout", async () => {
  const result = await runOverflowCheck([
    "--check-ui",
    `${fixtureOrigin}/missing`,
    "--browser-executable",
    chromium.executablePath(),
    "--json",
    "--no-interactive",
  ]);

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(JSON.parse(result.stderr)).toMatchObject({
    error: {
      code: "OVERFLOW_TARGET_UNAVAILABLE",
    },
    schemaVersion: 1,
  });

  const clientRedirect = await runOverflowCheck([
    "--check-ui",
    `${fixtureOrigin}/client-redirect`,
    "--browser-executable",
    chromium.executablePath(),
    "--json",
    "--no-interactive",
  ]);

  expect(clientRedirect.exitCode).toBe(1);
  expect(clientRedirect.stdout).toBe("");
  expect(clientRedirect.stderr).not.toContain("must-not-leak");
  expect(JSON.parse(clientRedirect.stderr)).toMatchObject({
    error: {
      code: "OVERFLOW_TARGET_UNAVAILABLE",
    },
    schemaVersion: 1,
  });

  const client404 = await runOverflowCheck([
    "--check-ui",
    `${fixtureOrigin}/client-404`,
    "--browser-executable",
    chromium.executablePath(),
    "--json",
    "--no-interactive",
  ]);

  expect(client404.exitCode).toBe(1);
  expect(client404.stdout).toBe("");
  expect(JSON.parse(client404.stderr)).toMatchObject({
    error: {
      code: "OVERFLOW_TARGET_UNAVAILABLE",
    },
    schemaVersion: 1,
  });

  const immediate404 = await runOverflowCheck([
    "--check-ui",
    `${fixtureOrigin}/immediate-404`,
    "--browser-executable",
    chromium.executablePath(),
    "--json",
    "--no-interactive",
  ]);

  expect(immediate404.exitCode).toBe(1);
  expect(immediate404.stdout).toBe("");
  expect(JSON.parse(immediate404.stderr)).toMatchObject({
    error: {
      code: "OVERFLOW_TARGET_UNAVAILABLE",
    },
    schemaVersion: 1,
  });

  const clientBlob = await runOverflowCheck([
    "--check-ui",
    `${fixtureOrigin}/client-blob`,
    "--browser-executable",
    chromium.executablePath(),
    "--json",
    "--no-interactive",
  ]);

  expect(clientBlob.exitCode).toBe(1);
  expect(clientBlob.stdout).toBe("");
  expect(JSON.parse(clientBlob.stderr)).toMatchObject({
    error: {
      code: "OVERFLOW_TARGET_UNAVAILABLE",
    },
    schemaVersion: 1,
  });
});
