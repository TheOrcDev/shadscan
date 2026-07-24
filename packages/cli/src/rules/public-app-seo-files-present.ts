import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";
import { findFiles, getProjectSourceFiles } from "./source-files";

const PRIVATE_INDEXING_PATTERN =
  /\bnoindex\b|\bindex\s*:\s*false\b|Disallow\s*:\s*\/(?:\s|$)/i;
const ROBOTS_PATTERNS = [
  "app/robots.{js,ts}",
  "src/app/robots.{js,ts}",
  "public/robots.txt",
];
const SITEMAP_PATTERNS = [
  "app/sitemap.{js,ts}",
  "src/app/sitemap.{js,ts}",
  "public/sitemap.xml",
];

const publicAppSeoFilesPresentRule: AuditRule = {
  adapters: [
    "next-app-router",
    "next-hybrid-router",
    "next-pages-router",
    "tanstack-start",
    "vite-react",
  ],
  category: "production-polish",
  confidence: "low",
  description:
    "Looks for robots and sitemap files in web apps that appear publicly indexable.",
  id: "public-app-seo-files-present",
  maxScore: 0,
  run: async ({ project }) => {
    const sourceFiles = await getProjectSourceFiles(project);
    const privateIndexingFile = sourceFiles.find((file) =>
      PRIVATE_INDEXING_PATTERN.test(file.content)
    );

    if (privateIndexingFile) {
      return notApplicable(
        "The app appears to opt out of indexing; public SEO files are not required."
      );
    }

    const robotsFiles = await findFiles(project.rootDir, ROBOTS_PATTERNS);
    const sitemapFiles = await findFiles(project.rootDir, SITEMAP_PATTERNS);
    const missingFiles: string[] = [];

    if (robotsFiles.length === 0) {
      missingFiles.push("robots");
    }

    if (sitemapFiles.length === 0) {
      missingFiles.push("sitemap");
    }

    if (missingFiles.length === 0) {
      return pass(
        "Robots and sitemap files are present for the public app.",
        robotsFiles[0]
      );
    }

    return fail(
      `The apparently public app is missing ${missingFiles.join(" and ")} files.`,
      "Add framework-native robots and sitemap files, or explicitly configure noindex when the app should remain private.",
      { filePath: project.paths.packageJson }
    );
  },
  severity: "info",
  title: "public apps expose robots and sitemap files",
};

export { publicAppSeoFilesPresentRule };
