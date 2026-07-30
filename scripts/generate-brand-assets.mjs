#!/usr/bin/env node
/**
 * Emits the downloadable brand assets from `lib/brand-assets.ts`, which stays
 * the single source of truth for shadscan's marks.
 *
 * The archive is committed rather than built during `next build`, because the
 * download has to exist on a plain static deploy that has no `zip` binary.
 * `--check` therefore does not rebuild it; it verifies the extracted SVGs match
 * the source and that the manifest records the same source digest the archive
 * was built from, which is what keeps a committed binary from drifting.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "public", "brand");
const ARCHIVE_NAME = "shadscan-brand-assets.zip";
const MANIFEST_NAME = "manifest.json";
const isCheck = process.argv.includes("--check");

const { LOGOMARK_SVG, LOGOTYPE_SVG } = await import(
  path.join(ROOT, "lib", "brand-assets.ts")
);

const README = `shadscan brand assets
=====================

logomark.svg   The scanner mark on its own.
logotype.svg   The mark locked up with the shadscan wordmark.

Both files use stroke="currentColor", so they take the colour of the text
around them when embedded in a page and fall back to black on their own.
Recolour by setting a colour on the SVG or its container; please do not
redraw, rotate, or stretch the mark.

Generated from lib/brand-assets.ts — do not edit these files by hand.
`;

const FILES = [
  { content: LOGOMARK_SVG, name: "logomark.svg" },
  { content: LOGOTYPE_SVG, name: "logotype.svg" },
  { content: README, name: "README.txt" },
];

const digest = (value) =>
  createHash("sha256").update(value).digest("hex").slice(0, 16);

/** One digest over every payload, so any edit to any asset invalidates it. */
const sourceDigest = digest(
  FILES.map((file) => `${file.name}\n${file.content}`).join("\0")
);

const readIfPresent = (filePath) => {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
};

if (isCheck) {
  const problems = [];

  for (const file of FILES) {
    const actual = readIfPresent(path.join(OUT_DIR, file.name));

    if (actual === null) {
      problems.push(`public/brand/${file.name} is missing.`);
    } else if (actual !== file.content) {
      problems.push(`public/brand/${file.name} is stale.`);
    }
  }

  const manifest = readIfPresent(path.join(OUT_DIR, MANIFEST_NAME));
  const recorded = manifest ? JSON.parse(manifest).sourceDigest : null;

  if (recorded !== sourceDigest) {
    problems.push(
      `public/brand/${ARCHIVE_NAME} was built from a different source (recorded ${recorded ?? "nothing"}, expected ${sourceDigest}).`
    );
  }

  if (problems.length > 0) {
    process.stderr.write(
      `Brand assets are out of date:\n${problems.map((problem) => `  - ${problem}`).join("\n")}\n\nRun \`pnpm brand:assets\` to regenerate them.\n`
    );
    process.exit(1);
  }

  process.stdout.write("Brand assets match lib/brand-assets.ts.\n");
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });

for (const file of FILES) {
  writeFileSync(path.join(OUT_DIR, file.name), file.content);
}

rmSync(path.join(OUT_DIR, ARCHIVE_NAME), { force: true });
// -X drops extra attributes so the archive is reproducible across machines.
execFileSync("zip", ["-qX", ARCHIVE_NAME, ...FILES.map((file) => file.name)], {
  cwd: OUT_DIR,
});

writeFileSync(
  path.join(OUT_DIR, MANIFEST_NAME),
  `${JSON.stringify(
    {
      archive: ARCHIVE_NAME,
      files: FILES.map((file) => file.name),
      sourceDigest,
    },
    null,
    2
  )}\n`
);

process.stdout.write(
  `Wrote ${FILES.length} brand assets and ${ARCHIVE_NAME} to public/brand (source ${sourceDigest}).\n`
);
