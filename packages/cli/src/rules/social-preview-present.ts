import path from "node:path";
import type { AuditRule, AuditRuleResult } from "../audit";
import type { ProjectDiscovery } from "../discovery";
import { getAstroSourceFiles } from "./astro-mounts";
import { fail, notApplicable, pass } from "./rule-result";
import {
  findProjectFiles,
  getProjectSourceFiles,
  getTextLineNumber,
  readProjectSourceFile,
} from "./source-files";

const NEXT_SOCIAL_METADATA_PATTERN =
  /(?:openGraph|twitter)\s*:\s*\{[\s\S]*?images?\s*:/;
const HTML_SOCIAL_IMAGE_PATTERN =
  /<meta(?=[^>]*(?:property|name)=["'](?:og:image|twitter:image)["'])(?=[^>]*content=["'][^"']+["'])[^>]*>/i;
// Astro templates pass values as expressions: content={ogImage}.
const ASTRO_SOCIAL_IMAGE_PATTERN =
  /<meta(?=[^>]*(?:property|name)=["'](?:og:image|twitter:image)["'])(?=[^>]*content=(?:["'][^"']+["']|\{[^}]+\}))[^>]*>/i;
const TANSTACK_SOCIAL_IMAGE_PATTERN =
  /(?:property|name)\s*:\s*["'](?:og:image|twitter:image)["']/;
const TANSTACK_SOCIAL_CONTENT_PATTERN = /\bcontent\s*:\s*["'`][^"'`]+["'`]/;

const evaluateAppRouterSocialPreview = async (
  project: ProjectDiscovery
): Promise<AuditRuleResult> => {
  const socialImageFiles = await findProjectFiles(project, [
    "app/**/opengraph-image.*",
    "app/**/twitter-image.*",
    "src/app/**/opengraph-image.*",
    "src/app/**/twitter-image.*",
  ]);

  if (socialImageFiles[0]) {
    return pass("Next social image file found.", socialImageFiles[0]);
  }

  const appDir = project.paths.appDir;
  const files = await getProjectSourceFiles(project);

  for (const file of files) {
    if (appDir) {
      const relativePath = path.relative(appDir, file.path);
      const isInsideApp =
        relativePath !== ".." &&
        !relativePath.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativePath);

      if (!isInsideApp) {
        continue;
      }
    }

    const line = getTextLineNumber(file.content, NEXT_SOCIAL_METADATA_PATTERN);

    if (line !== undefined) {
      return pass(
        "Image-backed Open Graph or Twitter metadata found.",
        file.path,
        line
      );
    }
  }

  return fail(
    "No App Router image-backed social preview was found.",
    "Add an opengraph-image/twitter-image file or images in Open Graph/Twitter metadata."
  );
};

const evaluatePagesRouterSocialPreview = async (
  project: ProjectDiscovery
): Promise<AuditRuleResult> => {
  const pagesDir = project.paths.pagesDir;
  const files = await getProjectSourceFiles(project);

  for (const file of files) {
    if (pagesDir) {
      const relativePath = path.relative(pagesDir, file.path);
      const isInsidePages =
        relativePath !== ".." &&
        !relativePath.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativePath);

      if (!isInsidePages) {
        continue;
      }
    }

    const line = getTextLineNumber(file.content, HTML_SOCIAL_IMAGE_PATTERN);

    if (line !== undefined) {
      return pass(
        "Pages Router social preview metadata found.",
        file.path,
        line
      );
    }
  }

  return fail(
    "No Pages Router social preview metadata was found.",
    "Add an og:image or twitter:image meta tag through `next/head`."
  );
};

const evaluateAstroSocialPreview = async (
  project: ProjectDiscovery
): Promise<AuditRuleResult> => {
  const astroFiles = await getAstroSourceFiles(project);

  for (const file of astroFiles) {
    const line = getTextLineNumber(file.content, ASTRO_SOCIAL_IMAGE_PATTERN);

    if (line !== undefined) {
      return pass(
        "Social preview image metadata found in an Astro head.",
        file.path,
        line
      );
    }
  }

  return fail(
    "No Open Graph or Twitter image metadata was found.",
    "Add an og:image or twitter:image meta tag with a public image URL to the layout's head."
  );
};

const evaluateTanstackStartSocialPreview = async (
  project: ProjectDiscovery
): Promise<AuditRuleResult> => {
  const files = await getProjectSourceFiles(project);

  for (const file of files) {
    if (
      TANSTACK_SOCIAL_IMAGE_PATTERN.test(file.content) &&
      TANSTACK_SOCIAL_CONTENT_PATTERN.test(file.content)
    ) {
      return pass(
        "Social preview image metadata found in head() meta entries.",
        file.path,
        getTextLineNumber(file.content, TANSTACK_SOCIAL_IMAGE_PATTERN)
      );
    }
  }

  return fail(
    "No Open Graph or Twitter image metadata was found.",
    "Add an og:image or twitter:image meta entry with a public image URL to the root route's head() option."
  );
};

const evaluateInertiaSocialPreview = async (
  project: ProjectDiscovery
): Promise<AuditRuleResult> => {
  const files = await getProjectSourceFiles(project);

  for (const file of files) {
    const line = getTextLineNumber(file.content, HTML_SOCIAL_IMAGE_PATTERN);

    if (line !== undefined) {
      return pass(
        "Social preview image metadata found in Inertia Head markup.",
        file.path,
        line
      );
    }
  }

  const bladeRootView = project.paths.bladeRootView;
  const bladeDocument = bladeRootView
    ? await readProjectSourceFile(project, bladeRootView)
    : null;
  const bladeLine = bladeDocument
    ? getTextLineNumber(bladeDocument.content, HTML_SOCIAL_IMAGE_PATTERN)
    : undefined;

  if (bladeDocument && bladeLine !== undefined) {
    return pass(
      "Social preview image metadata found in the Blade root view.",
      bladeDocument.path,
      bladeLine
    );
  }

  return fail(
    "No Open Graph or Twitter image metadata was found.",
    "Add an og:image or twitter:image meta tag through Inertia's `<Head>` or the Blade root view."
  );
};

const socialPreviewPresentRule: AuditRule = {
  adapters: ["core"],
  category: "production-polish",
  confidence: "high",
  description: "Checks for an image-backed social sharing preview.",
  id: "social-preview-present",
  maxScore: 2,
  run: async ({ project }) => {
    if (project.versions.next && project.paths.appDir) {
      const appResult = await evaluateAppRouterSocialPreview(project);

      if (appResult.status !== "pass" || !project.paths.pagesDir) {
        return appResult;
      }

      const pagesResult = await evaluatePagesRouterSocialPreview(project);

      if (pagesResult.status !== "pass") {
        return pagesResult;
      }

      const firstEvidence = appResult.evidence?.[0];
      return pass(
        "Both Next router trees configure image-backed social previews.",
        firstEvidence?.filePath,
        firstEvidence?.line
      );
    }

    if (project.versions.next && project.paths.pagesDir) {
      return evaluatePagesRouterSocialPreview(project);
    }

    if (project.versions.astro && project.paths.astroPagesDir) {
      return evaluateAstroSocialPreview(project);
    }

    if (project.versions.inertia && project.paths.inertiaPagesDir) {
      return evaluateInertiaSocialPreview(project);
    }

    if (project.versions.tanstackStart && project.paths.routesDir) {
      return evaluateTanstackStartSocialPreview(project);
    }

    const indexPath = path.join(project.rootDir, "index.html");
    const document = await readProjectSourceFile(project, indexPath);

    if (!document) {
      return notApplicable("No HTML document entry file was found.");
    }

    const line = getTextLineNumber(document.content, HTML_SOCIAL_IMAGE_PATTERN);

    if (line !== undefined) {
      return pass("Social preview image metadata found.", indexPath, line);
    }

    return fail(
      "No Open Graph or Twitter image metadata was found.",
      "Add an og:image or twitter:image meta tag with a public image URL.",
      { filePath: indexPath }
    );
  },
  severity: "info",
  title: "social preview is configured",
};

export { socialPreviewPresentRule };
