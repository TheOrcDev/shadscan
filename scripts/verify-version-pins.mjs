// Verifies that every advertised exact version pin matches the CLI package
// version. These pins live in prose and product copy, so nothing else fails
// when a release moves on — they went stale silently through 0.1.1 and 0.2.0.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const repoUrl = new URL("../", import.meta.url);

const readRepoFile = (relativePath) =>
  readFile(fileURLToPath(new URL(relativePath, repoUrl)), "utf8");

// Each source declares the patterns that must carry the current version. The
// capture group is the version; a source that matches nothing is an error,
// because a silently-renamed snippet is exactly the drift this guards against.
const PIN_SOURCES = [
  {
    patterns: [
      {
        label: "CI example command",
        pattern: /@shadscan\/cli@(\d+\.\d+\.\d+)/g,
      },
      {
        label: "GitHub Action version input",
        pattern: /version:\s*(\d+\.\d+\.\d+)/g,
      },
    ],
    path: "README.md",
  },
  {
    patterns: [
      {
        label: "GitHub Action version input",
        pattern: /version:\s*(\d+\.\d+\.\d+)/g,
      },
    ],
    path: "app/docs/page.tsx",
  },
  {
    patterns: [
      {
        label: "Consumer Guidance CI example",
        pattern: /@shadscan\/cli@(\d+\.\d+\.\d+)/g,
      },
    ],
    path: "docs/releasing.md",
  },
];

const getLineNumber = (content, index) =>
  content.slice(0, index).split("\n").length;

const main = async () => {
  const packageJson = JSON.parse(
    await readRepoFile("packages/cli/package.json")
  );
  const expectedVersion = packageJson.version;
  const problems = [];

  for (const source of PIN_SOURCES) {
    const content = await readRepoFile(source.path);

    for (const { label, pattern } of source.patterns) {
      pattern.lastIndex = 0;
      const matches = [...content.matchAll(pattern)];

      if (matches.length === 0) {
        problems.push(
          `${source.path}: no ${label} pin found; the snippet moved or was renamed, so this check no longer guards it.`
        );
        continue;
      }

      for (const match of matches) {
        if (match[1] === expectedVersion) {
          continue;
        }

        problems.push(
          `${source.path}:${getLineNumber(content, match.index)}: ${label} pins ${match[1]}, expected ${expectedVersion}.`
        );
      }
    }
  }

  if (problems.length > 0) {
    process.stderr.write(
      `Advertised version pins are out of sync with packages/cli/package.json (${expectedVersion}):\n${problems
        .map((problem) => `  - ${problem}`)
        .join(
          "\n"
        )}\n\nUpdate the pins, or update scripts/verify-version-pins.mjs if a snippet moved.\n`
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `All advertised version pins match ${expectedVersion}.\n`
  );
};

await main();
