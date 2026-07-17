import type { JsxElement, JsxOpeningLikeElement } from "typescript";
import { isJsxElement, isJsxSelfClosingElement } from "typescript";
import {
  ancestorHasTagName,
  type EvidenceState,
  getAccessibleTextState,
  getJsxAttribute,
  getJsxAttributeValue,
  getJsxTagName,
  getLineNumber,
  getTextAttributeState,
  hasJsxAttribute,
  hasVisualChild,
  parseProjectSourceFiles,
  visitJsxNodes,
  walkNodes,
} from "../ast";
import type { AuditEvidence, AuditRule, AuditRuleResult } from "../audit";

const BUTTON_TAGS = new Set(["Button", "button"]);
const FORM_CONTROL_TAGS = new Set(["input", "select", "textarea"]);
const NON_SEMANTIC_INTERACTIVE_TAGS = new Set(["div", "span"]);
const INTERACTIVE_ROLES = new Set([
  "button",
  "checkbox",
  "link",
  "menuitem",
  "option",
  "radio",
  "switch",
  "tab",
]);
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

const advisory = (
  message: string,
  remediation: string,
  filePath?: string,
  line?: number
): AuditRuleResult => ({
  confidence: "low",
  evidence: evidence(message, filePath, line),
  remediation,
  status: "advisory",
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

const getAccessibleNameState = (node: JsxOpeningLikeElement): EvidenceState => {
  const states = [
    getTextAttributeState(node, "aria-label"),
    getTextAttributeState(node, "aria-labelledby"),
    getTextAttributeState(node, "title"),
  ];

  if (states.includes("valid")) {
    return "valid";
  }

  return states.includes("unknown") ? "unknown" : "invalid";
};

const getInteractiveRoleState = (
  node: JsxOpeningLikeElement
): EvidenceState => {
  const role = getJsxAttributeValue(node, "role");

  if (role.kind === "dynamic") {
    return "unknown";
  }

  return role.kind === "static" &&
    typeof role.value === "string" &&
    INTERACTIVE_ROLES.has(role.value.trim().toLowerCase())
    ? "valid"
    : "invalid";
};

const getTabIndexState = (node: JsxOpeningLikeElement): EvidenceState => {
  const tabIndex = getJsxAttributeValue(node, "tabIndex");

  if (tabIndex.kind === "dynamic") {
    return "unknown";
  }

  if (tabIndex.kind !== "static") {
    return "invalid";
  }

  let numericValue = Number.NaN;

  if (typeof tabIndex.value === "number") {
    numericValue = tabIndex.value;
  } else if (
    typeof tabIndex.value === "string" &&
    tabIndex.value.trim().length > 0
  ) {
    numericValue = Number(tabIndex.value);
  }

  return Number.isFinite(numericValue) && numericValue >= 0
    ? "valid"
    : "invalid";
};

const getDialogTitleState = (node: JsxElement): EvidenceState => {
  const title = { state: "invalid" as EvidenceState };

  walkNodes(node, (descendant) => {
    if (!isJsxElement(descendant)) {
      return;
    }

    const descendantTag = getJsxTagName(descendant.openingElement);

    if (!(descendantTag && DIALOG_TITLE_TAGS.has(descendantTag))) {
      return;
    }

    const descendantState = getAccessibleTextState(descendant.children);

    if (descendantState === "valid" || title.state === "invalid") {
      title.state = descendantState;
    }
  });

  return title.state;
};

type InteractiveElementEvaluation =
  | { status: "advisory" | "ignored" | "pass" }
  | { missing: string[]; status: "fail" };

const evaluateInteractiveElement = (
  node: JsxElement | JsxOpeningLikeElement
): InteractiveElementEvaluation => {
  const openingElement = getOpeningElement(node);
  const tagName = getJsxTagName(openingElement);

  if (
    !(
      tagName &&
      NON_SEMANTIC_INTERACTIVE_TAGS.has(tagName) &&
      hasJsxAttribute(openingElement, "onClick")
    )
  ) {
    return { status: "ignored" };
  }

  const roleState = getInteractiveRoleState(openingElement);
  const tabIndexState = getTabIndexState(openingElement);
  const hasKeyboardHandler =
    hasJsxAttribute(openingElement, "onKeyDown") ||
    hasJsxAttribute(openingElement, "onKeyUp") ||
    hasJsxAttribute(openingElement, "onKeyPress");
  const missing = [
    roleState === "invalid" ? "an interactive role" : null,
    tabIndexState === "invalid" ? "a non-negative tabIndex" : null,
    hasKeyboardHandler ? null : "keyboard handling",
  ].filter((item): item is string => item !== null);

  if (missing.length > 0) {
    return { missing, status: "fail" };
  }

  return roleState === "unknown" || tabIndexState === "unknown"
    ? { status: "advisory" }
    : { status: "pass" };
};

const evaluateDialogName = (
  node: JsxElement | JsxOpeningLikeElement
): EvidenceState | null => {
  if (!(isJsxElement(node) || isJsxSelfClosingElement(node))) {
    return null;
  }

  const openingElement = getOpeningElement(node);
  const tagName = getJsxTagName(openingElement);

  if (!(tagName && DIALOG_CONTENT_TAGS.has(tagName))) {
    return null;
  }

  const nameState = getAccessibleNameState(openingElement);
  const titleState = isJsxElement(node) ? getDialogTitleState(node) : "invalid";

  if (nameState === "valid" || titleState === "valid") {
    return "valid";
  }

  return nameState === "unknown" || titleState === "unknown"
    ? "unknown"
    : "invalid";
};

const iconButtonsHaveLabelsRule: AuditRule = {
  adapters: ["core"],
  category: "accessibility",
  confidence: "high",
  description: "Checks icon-only buttons for accessible labels.",
  id: "icon-buttons-have-labels",
  maxScore: 6,
  run: async ({ project }) => {
    const files = await parseProjectSourceFiles(project);
    let uncertainResult: AuditRuleResult | null = null;

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

        const nameState = getAccessibleNameState(openingElement);
        const textState = getAccessibleTextState(node.children);

        if (nameState === "valid" || textState === "valid") {
          return;
        }

        if (!hasVisualChild(node.children)) {
          return;
        }

        if (nameState === "unknown" || textState === "unknown") {
          uncertainResult ??= advisory(
            "Icon-only button uses a dynamic accessible name that cannot be verified statically.",
            "Ensure the dynamic label always resolves to meaningful text.",
            file.filePath,
            getLineNumber(file, openingElement)
          );
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

    return uncertainResult ?? pass("No unlabeled icon-only buttons found.");
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
    let uncertainResult: AuditRuleResult | null = null;

    for (const file of files) {
      let failure: AuditRuleResult | null = null;

      visitJsxNodes([file], ({ node }) => {
        if (failure) {
          return;
        }

        const openingElement = getOpeningElement(node);
        const evaluation = evaluateInteractiveElement(node);

        if (evaluation.status === "fail") {
          failure = fail(
            `Non-semantic clickable element is missing ${evaluation.missing.join(", ")}.`,
            "Use a real `button`/`a`, or add role, tabIndex, and keyboard handling.",
            file.filePath,
            getLineNumber(file, openingElement)
          );
          return;
        }

        if (evaluation.status === "advisory") {
          uncertainResult ??= advisory(
            "Clickable non-semantic element uses dynamic role or tabIndex values.",
            "Ensure it always renders an interactive role and a non-negative tabIndex, or use a native control.",
            file.filePath,
            getLineNumber(file, openingElement)
          );
        }
      });

      if (failure) {
        return failure;
      }
    }

    return (
      uncertainResult ?? pass("No obvious non-semantic click targets found.")
    );
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
    let uncertainResult: AuditRuleResult | null = null;

    for (const file of files) {
      const labelTargets = new Set<string>();
      let failure: AuditRuleResult | null = null;

      visitJsxNodes([file], ({ node }) => {
        const openingElement = getOpeningElement(node);
        const tagName = getJsxTagName(openingElement);

        if (tagName === "label") {
          const htmlFor = getJsxAttribute(openingElement, "htmlFor");

          if (typeof htmlFor === "string" && htmlFor.trim().length > 0) {
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
        const isLabeledById =
          typeof id === "string" &&
          id.trim().length > 0 &&
          labelTargets.has(id);
        const isWrappedByLabel = ancestorHasTagName(ancestors, "label");
        const accessibleNameState = getAccessibleNameState(openingElement);

        if (
          isLabeledById ||
          isWrappedByLabel ||
          accessibleNameState === "valid"
        ) {
          return;
        }

        if (accessibleNameState === "unknown") {
          uncertainResult ??= advisory(
            "Form control uses a dynamic accessible name that cannot be verified statically.",
            "Ensure the dynamic label always resolves to meaningful text.",
            file.filePath,
            getLineNumber(file, openingElement)
          );
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

    return uncertainResult ?? pass("No unlabeled form controls found.");
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
    let uncertainResult: AuditRuleResult | null = null;

    for (const file of files) {
      let failure: AuditRuleResult | null = null;

      visitJsxNodes([file], ({ node }) => {
        if (failure) {
          return;
        }

        const openingElement = getOpeningElement(node);
        const nameState = evaluateDialogName(node);

        if (nameState === null || nameState === "valid") {
          return;
        }

        if (nameState === "unknown") {
          uncertainResult ??= advisory(
            "Dialog content uses a dynamic title or label that cannot be verified statically.",
            "Ensure every rendered dialog title or label resolves to meaningful text.",
            file.filePath,
            getLineNumber(file, openingElement)
          );
          return;
        }

        failure = fail(
          "Dialog or sheet content was found without a matching title.",
          "Add `DialogTitle`, `SheetTitle`, `AlertDialogTitle`, or an accessible label.",
          file.filePath,
          getLineNumber(file, openingElement)
        );
      });

      if (failure) {
        return failure;
      }
    }

    return (
      uncertainResult ?? pass("No untitled dialog or sheet content found.")
    );
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
