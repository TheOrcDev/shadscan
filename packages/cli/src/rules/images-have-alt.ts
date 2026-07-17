import { isJsxElement } from "typescript";
import {
  getJsxTagName,
  getLineNumber,
  hasJsxAttribute,
  parseProjectSourceFiles,
  visitJsxNodes,
} from "../ast";
import type { AuditRule, AuditRuleResult } from "../audit";
import { fail, pass } from "./rule-result";

const IMAGE_TAGS = new Set(["Image", "img"]);

const imagesHaveAltRule: AuditRule = {
  adapters: ["core"],
  category: "accessibility",
  confidence: "high",
  description: "Checks native and Next images for alternative text.",
  id: "images-have-alt",
  maxScore: 4,
  run: async ({ project }) => {
    const files = await parseProjectSourceFiles(project);
    let failure: AuditRuleResult | null = null;

    visitJsxNodes(files, ({ file, node }) => {
      if (failure || isJsxElement(node)) {
        return;
      }

      const tagName = getJsxTagName(node);

      if (!(tagName && IMAGE_TAGS.has(tagName))) {
        return;
      }

      if (hasJsxAttribute(node, "alt")) {
        return;
      }

      failure = fail(
        "Image is missing alternative text.",
        'Add a meaningful alt value or use alt="" for a decorative image.',
        { filePath: file.filePath, line: getLineNumber(file, node) }
      );
    });

    return failure ?? pass("No images without alternative text were found.");
  },
  severity: "error",
  title: "images have alternative text",
};

export { imagesHaveAltRule };
