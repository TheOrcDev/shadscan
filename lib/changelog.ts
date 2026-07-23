import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { load } from "js-yaml";
import { Marked } from "marked";
import { z } from "zod";

const CHANGELOG_DIRECTORY = path.join(process.cwd(), "changelog");
const RELEASE_FILE_PATTERN = /\.md$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const ANCHOR_SEPARATOR_PATTERN = /[^a-z0-9]+/g;
const VERSION_SEGMENT_SEPARATOR_PATTERN = /[.-]/;
const NON_DIGIT_PATTERN = /\D/g;
// Body headings render one level below the h2 release title.
const HEADING_DEPTH_OFFSET = 1;
const MAX_HEADING_DEPTH = 6;

const ReleaseFrontmatterSchema = z.object({
  channel: z.enum(["latest", "next"]),
  // YAML parses unquoted dates as Date objects; normalize both forms.
  date: z.preprocess(
    (value) =>
      value instanceof Date ? value.toISOString().slice(0, 10) : value,
    z.string().regex(DATE_PATTERN)
  ),
  highlights: z.array(z.string().min(1)).min(1),
  summary: z.string().min(1),
  title: z.string().min(1),
  version: z.string().min(1),
});

interface ChangelogRelease {
  anchorId: string;
  bodyHtml: string;
  channel: "latest" | "next";
  date: string;
  highlights: readonly string[];
  summary: string;
  title: string;
  version: string;
}

const toAnchorId = (version: string): string =>
  version.toLowerCase().replaceAll(ANCHOR_SEPARATOR_PATTERN, "-");

interface ParsedReleaseFile {
  content: string;
  data: unknown;
}

const parseReleaseFile = (raw: string, fileName: string): ParsedReleaseFile => {
  const frontmatterMatch = raw.match(FRONTMATTER_PATTERN);
  if (!frontmatterMatch?.[1]) {
    throw new Error(`Changelog entry ${fileName} is missing frontmatter.`);
  }

  return {
    content: raw.slice(frontmatterMatch[0].length),
    data: load(frontmatterMatch[1]),
  };
};

const createReleaseMarkdownRenderer = (): Marked => {
  const renderer = new Marked({ async: false, breaks: false, gfm: true });

  renderer.use({
    renderer: {
      heading({ depth, tokens }) {
        const level = Math.min(depth + HEADING_DEPTH_OFFSET, MAX_HEADING_DEPTH);
        return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>\n`;
      },
    },
  });

  return renderer;
};

const compareVersionsDescending = (left: string, right: string): number => {
  const toParts = (version: string): number[] =>
    version.split(VERSION_SEGMENT_SEPARATOR_PATTERN).map((part) => {
      const numeric = Number.parseInt(part.replace(NON_DIGIT_PATTERN, ""), 10);
      return Number.isNaN(numeric) ? 0 : numeric;
    });
  const leftParts = toParts(left);
  const rightParts = toParts(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    // Extra segments only come from prerelease suffixes, so the version
    // missing a segment is the stable release and must sort first.
    const leftPart = leftParts[index] ?? Number.POSITIVE_INFINITY;
    const rightPart = rightParts[index] ?? Number.POSITIVE_INFINITY;
    if (leftPart !== rightPart) {
      return rightPart > leftPart ? 1 : -1;
    }
  }
  return 0;
};

const getChangelogReleases = async (): Promise<ChangelogRelease[]> => {
  const entries = await readdir(CHANGELOG_DIRECTORY);
  const markdownRenderer = createReleaseMarkdownRenderer();
  const releases: ChangelogRelease[] = [];

  for (const entry of entries) {
    if (!RELEASE_FILE_PATTERN.test(entry)) {
      continue;
    }

    const filePath = path.join(CHANGELOG_DIRECTORY, entry);
    const parsedFile = parseReleaseFile(
      await readFile(filePath, "utf8"),
      entry
    );
    const frontmatter = ReleaseFrontmatterSchema.parse(parsedFile.data);

    releases.push({
      anchorId: toAnchorId(frontmatter.version),
      bodyHtml: markdownRenderer.parse(parsedFile.content, {
        async: false,
      }) as string,
      channel: frontmatter.channel,
      date: frontmatter.date,
      highlights: frontmatter.highlights,
      summary: frontmatter.summary,
      title: frontmatter.title,
      version: frontmatter.version,
    });
  }

  return releases.sort(
    (left, right) =>
      right.date.localeCompare(left.date) ||
      compareVersionsDescending(left.version, right.version)
  );
};

export type { ChangelogRelease };
export { getChangelogReleases };
