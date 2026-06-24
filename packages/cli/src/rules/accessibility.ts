import type { JsxElement, JsxOpeningLikeElement } from "typescript";
import { isJsxElement } from "typescript";
import {
  ancestorHasTagName,
  getJsxAttribute,
  getJsxTagName,
  getLineNumber,
  hasAccessibleText,
  hasJsxAttribute,
  hasVisualChild,
  parseProjectSourceFiles,
  visitJsxNodes,
} from "../ast";
import type { AuditEvidence, AuditRule, AuditRuleResult } from "../audit";

const BUTTON_TAGS = new Set(["Button", "button"]);
const FORM_CONTROL_TAGS = new Set(["input", "select", "textarea"]);
const NON_SEMANTIC_INTERACTIVE_TAGS = new Set(["div", "span"]);
const DIALOG_CONTENT_TAGS = new Set([
  "AlertDialogContent",
  "DialogContent",
  "SheetContent",
]);
const DIALOG_TITLE_TAGS = new Set([
  "AlertDialogTitle",
  "DialogTitle",
  "SheetTitle",
]);

const evidence = (
  message: string,
  filePath?: string,
  line?: number
): AuditEvidence[] => [
  {
    filePath,
    line,
    message,
  },
];

const pass = (message: string): AuditRuleResult => ({
  evidence: evidence(message),
  status: "pass",
});

const fail = (
  message: string,
  remediation: string,
  filePath?: string,
  line?: number,
  roast?: string
): AuditRuleResult => ({
  evidence: evidence(message, filePath, line),
  remediation,
  roast,
  status: "fail",
});

const getOpeningElement = (
  node: JsxElement | JsxOpeningLikeElement
): JsxOpeningLikeElement => (isJsxElement(node) ? node.openingElement : node);

const hasAccessibleName = (node: JsxOpeningLikeElement): boolean =>
  hasJsxAttribute(node, "aria-label") ||
  hasJsxAttribute(node, "aria-labelledby") ||
  hasJsxAttribute(node, "title");

const iconButtonsHaveLabelsRule: AuditRule = {
  adapters: ["core"],
  category: "accessibility",
  confidence: "high",
  description: "Checks icon-only buttons for accessible labels.",
  id: "icon-buttons-have-labels",
  maxScore: 6,
  run: async ({ project }) => {
    const files = await parseProjectSourceFiles(project);

    for (const file of files) {
      let failure: AuditRuleResult | null = null;

      visitJsxNodes([file], ({ node }) => {
        if (failure || !isJsxElement(node)) {
          return;
        }

        const openingElement = node.openingElement;
        const tagName = getJsxTagName(openingElement);

        if (!(tagName && BUTTON_TAGS.has(tagName))) {
          return;
        }

        if (
          hasAccessibleName(openingElement) ||
          hasAccessibleText(node.children)
        ) {
          return;
        }

        if (!hasVisualChild(node.children)) {
          return;
        }

        failure = fail(
          "Icon-only button is missing an accessible label.",
          "Add `aria-label`, `aria-labelledby`, `title`, or text such as an `sr-only` label.",
          file.filePath,
          getLineNumber(file, openingElement),
          "The screen reader just got handed a mystery meat button."
        );
      });

      if (failure) {
        return failure;
      }
    }

    return pass("No unlabeled icon-only buttons found.");
  },
  severity: "error",
  title: "icon buttons have labels",
};

const interactiveElementsAreSemanticRule: AuditRule = {
  adapters: ["core"],
  category: "accessibility",
  confidence: "high",
  description:
    "Checks obvious clickable div/span elements for keyboard support.",
  id: "interactive-elements-are-semantic",
  maxScore: 3,
  run: async ({ project }) => {
    const files = await parseProjectSourceFiles(project);

    for (const file of files) {
      let failure: AuditRuleResult | null = null;

      visitJsxNodes([file], ({ node }) => {
        if (failure) {
          return;
        }

        const openingElement = getOpeningElement(node);
        const tagName = getJsxTagName(openingElement);

        if (!(tagName && NON_SEMANTIC_INTERACTIVE_TAGS.has(tagName))) {
          return;
        }

        const hasClick = hasJsxAttribute(openingElement, "onClick");
        const hasKeyboardHandler =
          hasJsxAttribute(openingElement, "onKeyDown") ||
          hasJsxAttribute(openingElement, "onKeyUp") ||
          hasJsxAttribute(openingElement, "onKeyPress");

        if (hasClick && !hasKeyboardHandler) {
          failure = fail(
            "Non-semantic clickable element is missing keyboard support.",
            "Use a real `button`/`a`, or add role, tabIndex, and keyboard handling.",
            file.filePath,
            getLineNumber(file, openingElement)
          );
        }
      });

      if (failure) {
        return failure;
      }
    }

    return pass("No obvious non-semantic click targets found.");
  },
  severity: "warning",
  title: "interactive elements are semantic",
};

const formsHaveLabelsRule: AuditRule = {
  adapters: ["core"],
  category: "accessibility",
  confidence: "high",
  description:
    "Checks form controls for associated labels or accessible names.",
  id: "forms-have-labels",
  maxScore: 4,
  run: async ({ project }) => {
    const files = await parseProjectSourceFiles(project);

    for (const file of files) {
      const labelTargets = new Set<string>();
      let failure: AuditRuleResult | null = null;

      visitJsxNodes([file], ({ node }) => {
        const openingElement = getOpeningElement(node);
        const tagName = getJsxTagName(openingElement);

        if (tagName === "label") {
          const htmlFor = getJsxAttribute(openingElement, "htmlFor");

          if (typeof htmlFor === "string") {
            labelTargets.add(htmlFor);
          }
        }
      });

      visitJsxNodes([file], ({ ancestors, node }) => {
        if (failure) {
          return;
        }

        const openingElement = getOpeningElement(node);
        const tagName = getJsxTagName(openingElement);

        if (!(tagName && FORM_CONTROL_TAGS.has(tagName))) {
          return;
        }

        if (getJsxAttribute(openingElement, "type") === "hidden") {
          return;
        }

        const id = getJsxAttribute(openingElement, "id");
        const isLabeledById = typeof id === "string" && labelTargets.has(id);
        const isWrappedByLabel = ancestorHasTagName(ancestors, "label");

        if (
          isLabeledById ||
          isWrappedByLabel ||
          hasAccessibleName(openingElement)
        ) {
          return;
        }

        failure = fail(
          "Form control is missing a label or accessible name.",
          "Associate the control with a `<label htmlFor>`, wrap it in a label, or add an accessible name.",
          file.filePath,
          getLineNumber(file, openingElement)
        );
      });

      if (failure) {
        return failure;
      }
    }

    return pass("No unlabeled form controls found.");
  },
  severity: "error",
  title: "forms have labels",
};

const dialogsHaveAccessibleNamesRule: AuditRule = {
  adapters: ["core"],
  category: "accessibility",
  confidence: "medium",
  description: "Checks dialog/sheet content for a title or accessible name.",
  id: "dialogs-have-accessible-names",
  maxScore: 2,
  run: async ({ project }) => {
    const files = await parseProjectSourceFiles(project);

    for (const file of files) {
      let hasDialogContent = false;
      let hasDialogTitle = false;
      let labeledDialogContent: AuditRuleResult | null = null;
      let contentLine = 1;

      visitJsxNodes([file], ({ node }) => {
        const openingElement = getOpeningElement(node);
        const tagName = getJsxTagName(openingElement);

        if (tagName && DIALOG_TITLE_TAGS.has(tagName)) {
          hasDialogTitle = true;
        }

        if (tagName && DIALOG_CONTENT_TAGS.has(tagName)) {
          hasDialogContent = true;
          contentLine = getLineNumber(file, openingElement);

          if (hasAccessibleName(openingElement)) {
            labeledDialogContent = pass(
              "Dialog content has an accessible name."
            );
          }
        }
      });

      if (labeledDialogContent) {
        return labeledDialogContent;
      }

      if (hasDialogContent && !hasDialogTitle) {
        return fail(
          "Dialog or sheet content was found without a matching title.",
          "Add `DialogTitle`, `SheetTitle`, `AlertDialogTitle`, or an accessible label.",
          file.filePath,
          contentLine
        );
      }
    }

    return pass("No untitled dialog or sheet content found.");
  },
  severity: "warning",
  title: "dialogs have accessible names",
};

const accessibilityRules = [
  iconButtonsHaveLabelsRule,
  interactiveElementsAreSemanticRule,
  formsHaveLabelsRule,
  dialogsHaveAccessibleNamesRule,
] satisfies AuditRule[];

export { accessibilityRules };
