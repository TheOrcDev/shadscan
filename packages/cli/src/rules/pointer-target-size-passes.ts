import { isJsxElement } from "typescript";
import {
  getJsxAttribute,
  getJsxTagName,
  getLineNumber,
  parseProjectSourceFiles,
  visitJsxNodes,
} from "../ast";
import type { AuditRule } from "../audit";
import { advisory, notApplicable } from "./rule-result";

interface ControlOccurrence {
  className: string | true | null;
  filePath: string;
  line: number;
  tagName: string;
}

const INTERACTIVE_TAGS = new Set([
  "Button",
  "Checkbox",
  "DropdownMenuItem",
  "Input",
  "Link",
  "SelectTrigger",
  "Switch",
  "TabsTrigger",
  "Toggle",
  "a",
  "button",
  "input",
  "select",
]);
const SMALL_TAILWIND_SIZE =
  "(?:0(?:\\.5)?|1(?:\\.5)?|2(?:\\.5)?|3(?:\\.5)?|4(?:\\.5)?|5(?:\\.5)?)";
const SMALL_SQUARE_PATTERN = new RegExp(`\\bsize-${SMALL_TAILWIND_SIZE}\\b`);
const SMALL_HEIGHT_PATTERN = new RegExp(`\\bh-${SMALL_TAILWIND_SIZE}\\b`);
const SMALL_WIDTH_PATTERN = new RegExp(`\\bw-${SMALL_TAILWIND_SIZE}\\b`);
const GENERATED_UI_PATH_PATTERN = /[/\\]components[/\\]ui[/\\]/;

const hasObviouslySmallTarget = (className: string | true | null): boolean =>
  typeof className === "string" &&
  (SMALL_SQUARE_PATTERN.test(className) ||
    (SMALL_HEIGHT_PATTERN.test(className) &&
      SMALL_WIDTH_PATTERN.test(className)));

const pointerTargetSizePassesRule: AuditRule = {
  adapters: ["core"],
  category: "accessibility",
  confidence: "low",
  description:
    "Marks interactive controls for rendered pointer-target size verification.",
  id: "pointer-target-size-passes",
  maxScore: 0,
  run: async ({ project }) => {
    const files = (await parseProjectSourceFiles(project)).filter(
      (file) => !GENERATED_UI_PATH_PATTERN.test(file.filePath)
    );
    const controls: ControlOccurrence[] = [];

    visitJsxNodes(files, ({ file, node }) => {
      if (isJsxElement(node)) {
        return;
      }

      const tagName = getJsxTagName(node);

      if (!(tagName && INTERACTIVE_TAGS.has(tagName))) {
        return;
      }

      controls.push({
        className: getJsxAttribute(node, "className"),
        filePath: file.filePath,
        line: getLineNumber(file, node),
        tagName,
      });
    });

    const firstControl = controls[0];

    if (!firstControl) {
      return notApplicable("No app-level interactive controls were found.");
    }

    const smallControl = controls.find((control) =>
      hasObviouslySmallTarget(control.className)
    );

    if (smallControl) {
      return advisory(
        `${smallControl.tagName} uses literal dimensions below the 24px target-size baseline.`,
        "Increase the clickable area to at least 24 by 24 CSS pixels or provide sufficient spacing from adjacent targets, then verify it in a browser.",
        smallControl.filePath,
        smallControl.line
      );
    }

    return advisory(
      `${controls.length} interactive controls need rendered target-size verification.`,
      "Verify every pointer target is at least 24 by 24 CSS pixels or has sufficient spacing from adjacent targets at each viewport.",
      firstControl.filePath,
      firstControl.line
    );
  },
  severity: "warning",
  title: "pointer targets meet minimum rendered size",
};

export { pointerTargetSizePassesRule };
