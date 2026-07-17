import path from "node:path";
import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";
import {
  fileExists,
  findFiles,
  getProjectSourceFiles,
  getTextLineNumber,
  readSourceFile,
} from "./source-files";

const NEXT_SOCIAL_METADATA_PATTERN =
  /(?:openGraph|twitter)\s*:\s*\{[\s\S]*?images?\s*:/;
const HTML_SOCIAL_IMAGE_PATTERN =
  /<meta(?=[^>]*(?:property|name)=["'](?:og:image|twitter:image)["'])(?=[^>]*content=["'][^"']+["'])[^>]*>/i;

const socialPreviewPresentRule: AuditRule = {
  adapters: ["core"],
  category: "production-polish",
  confidence: "high",
  description: "Checks for an image-backed social sharing preview.",
  id: "social-preview-present",
  maxScore: 2,
  run: async ({ project }) => {
    if (project.framework.adapter === "next-app-router") {
      const socialImageFiles = await findFiles(project.rootDir, [
        "app/**/opengraph-image.*",
        "app/**/twitter-image.*",
        "src/app/**/opengraph-image.*",
        "src/app/**/twitter-image.*",
      ]);

      if (socialImageFiles[0]) {
        return pass("Next social image file found.", socialImageFiles[0]);
      }

      const files = await getProjectSourceFiles(project);

      for (const file of files) {
        const line = getTextLineNumber(
          file.content,
          NEXT_SOCIAL_METADATA_PATTERN
        );

        if (line !== undefined) {
          return pass(
            "Image-backed Open Graph or Twitter metadata found.",
            file.path,
            line
          );
        }
      }

      return fail(
        "No image-backed social preview was found.",
        "Add an opengraph-image/twitter-image file or images in Open Graph/Twitter metadata."
      );
    }

    const indexPath = path.join(project.rootDir, "index.html");

    if (!(await fileExists(indexPath))) {
      return notApplicable("No HTML document entry file was found.");
    }

    const document = await readSourceFile(indexPath);
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
