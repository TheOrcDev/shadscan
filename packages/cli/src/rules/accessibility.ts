import {
  isJsxElement,
  isJsxSelfClosingElement,
  isJsxSpreadAttribute,
  type JsxElement,
  type JsxOpeningLikeElement,
  type Node,
} from "typescript";
import {
  ancestorHasTagName,
  type EvidenceState,
  getAccessibleTextState,
  getJsxAttribute,
  getJsxAttributeIdentity,
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
const FORM_CONTROL_TAGS = new Set([
  "Input",
  "Textarea",
  "input",
  "select",
  "textarea",
]);
const FORM_LABEL_TAGS = new Set(["FieldLabel", "FormLabel", "Label", "label"]);
const FORM_WRAPPER_TAGS = new Set(["Input", "Textarea"]);
const GENERATED_FORM_PASS_THROUGH_TAGS = new Set([
  "Input",
  "Textarea",
  "input",
  "textarea",
]);
const GENERATED_UI_PATH_PATTERN = /[/\\]components[/\\]ui[/\\]/;
const INPUT_FOCUS_DELEGATION_PATTERN =
  /\.querySelector\(\s*["'](?:input|textarea)["']\s*\)\?\.focus\(\)/;
const MAX_FORM_LABEL_EVIDENCE = 5;
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

const getFormAccessibleNameState = (
  node: JsxOpeningLikeElement
): EvidenceState => {
  const states = [
    getTextAttributeState(node, "aria-label"),
    getTextAttributeState(node, "aria-labelledby"),
  ];

  if (states.includes("valid")) {
    return "valid";
  }

  return states.includes("unknown") ? "unknown" : "invalid";
};

const getNearestFormItem = (ancestors: Node[]): JsxElement | null => {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index];

    if (
      ancestor &&
      isJsxElement(ancestor) &&
      getJsxTagName(ancestor.openingElement) === "FormItem"
    ) {
      return ancestor;
    }
  }

  return null;
};

const getFormItemLabelState = (formItem: JsxElement): EvidenceState => {
  let hasDynamicLabel = false;
  let hasStaticLabel = false;

  walkNodes(formItem, (node, ancestors) => {
    if (hasStaticLabel || !isJsxElement(node)) {
      return;
    }

    const isInsideNestedFormItem = ancestors.some(
      (ancestor) =>
        ancestor !== formItem &&
        isJsxElement(ancestor) &&
        getJsxTagName(ancestor.openingElement) === "FormItem"
    );

    if (
      isInsideNestedFormItem ||
      getJsxTagName(node.openingElement) !== "FormLabel"
    ) {
      return;
    }

    const labelState = getAccessibleTextState(node.children);

    if (labelState === "valid") {
      hasStaticLabel = true;
    } else if (labelState === "unknown") {
      hasDynamicLabel = true;
    }
  });

  if (hasStaticLabel) {
    return "valid";
  }

  return hasDynamicLabel ? "unknown" : "invalid";
};

const isGeneratedPassThroughFormPrimitive = (
  filePath: string,
  openingElement: JsxOpeningLikeElement,
  tagName: string
): boolean =>
  GENERATED_UI_PATH_PATTERN.test(filePath) &&
  GENERATED_FORM_PASS_THROUGH_TAGS.has(tagName) &&
  openingElement.attributes.properties.some((property) =>
    isJsxSpreadAttribute(property)
  );

interface FormControlCandidate {
  openingElement: JsxOpeningLikeElement;
  tagName: string;
}

const getFormControlCandidate = (
  filePath: string,
  node: JsxElement | JsxOpeningLikeElement
): FormControlCandidate | null => {
  if (!(isJsxElement(node) || isJsxSelfClosingElement(node))) {
    return null;
  }

  const openingElement = getOpeningElement(node);
  const tagName = getJsxTagName(openingElement);

  if (!(tagName && FORM_CONTROL_TAGS.has(tagName))) {
    return null;
  }

  if (
    isGeneratedPassThroughFormPrimitive(filePath, openingElement, tagName) ||
    getJsxAttribute(openingElement, "type") === "hidden"
  ) {
    return null;
  }

  return { openingElement, tagName };
};

const getFormControlLabelState = ({
  ancestors,
  labelTargets,
  openingElement,
}: {
  ancestors: Node[];
  labelTargets: Set<string>;
  openingElement: JsxOpeningLikeElement;
}): EvidenceState => {
  const id = getJsxAttributeIdentity(openingElement, "id");
  const isLabeledById = id !== null && labelTargets.has(id);
  const isWrappedByLabel = [...FORM_LABEL_TAGS].some((tagName) =>
    ancestorHasTagName(ancestors, tagName)
  );
  const accessibleNameState = getFormAccessibleNameState(openingElement);
  const formItem = ancestorHasTagName(ancestors, "FormControl")
    ? getNearestFormItem(ancestors)
    : null;
  const formItemLabelState = formItem
    ? getFormItemLabelState(formItem)
    : "invalid";

  if (
    isLabeledById ||
    isWrappedByLabel ||
    accessibleNameState === "valid" ||
    formItemLabelState === "valid"
  ) {
    return "valid";
  }

  return accessibleNameState === "unknown" || formItemLabelState === "unknown"
    ? "unknown"
    : "invalid";
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

const isGeneratedInputGroupFocusDelegation = (
  filePath: string,
  openingElement: JsxOpeningLikeElement
): boolean => {
  if (
    !GENERATED_UI_PATH_PATTERN.test(filePath) ||
    getJsxAttribute(openingElement, "data-slot") !== "input-group-addon"
  ) {
    return false;
  }

  const onClick = getJsxAttributeIdentity(openingElement, "onClick");
  return onClick !== null && INPUT_FOCUS_DELEGATION_PATTERN.test(onClick);
};

const evaluateInteractiveElement = (
  node: JsxElement | JsxOpeningLikeElement,
  filePath: string
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

  if (isGeneratedInputGroupFocusDelegation(filePath, openingElement)) {
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
        const evaluation = evaluateInteractiveElement(node, file.filePath);

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
    "Checks native form controls and common shadcn field wrappers for associated labels or accessible names.",
  id: "forms-have-labels",
  maxScore: 4,
  run: async ({ project }) => {
    const files = await parseProjectSourceFiles(project);
    const failures: AuditEvidence[] = [];
    let uncertainResult: AuditRuleResult | null = null;

    for (const file of files) {
      const labelTargets = new Set<string>();

      visitJsxNodes([file], ({ node }) => {
        const openingElement = getOpeningElement(node);
        const tagName = getJsxTagName(openingElement);

        if (tagName && FORM_LABEL_TAGS.has(tagName)) {
          const htmlFor = getJsxAttributeIdentity(openingElement, "htmlFor");

          if (htmlFor) {
            labelTargets.add(htmlFor);
          }
        }
      });

      visitJsxNodes([file], ({ ancestors, node }) => {
        if (failures.length >= MAX_FORM_LABEL_EVIDENCE) {
          return;
        }

        const candidate = getFormControlCandidate(file.filePath, node);

        if (!candidate) {
          return;
        }

        const { openingElement, tagName } = candidate;

        const labelState = getFormControlLabelState({
          ancestors,
          labelTargets,
          openingElement,
        });

        if (labelState === "valid") {
          return;
        }

        if (labelState === "unknown") {
          uncertainResult ??= advisory(
            `${tagName} uses a dynamic accessible label that cannot be verified statically.`,
            "Ensure the dynamic label always resolves to meaningful text.",
            file.filePath,
            getLineNumber(file, openingElement)
          );
          return;
        }

        failures.push({
          filePath: file.filePath,
          line: getLineNumber(file, openingElement),
          message: FORM_WRAPPER_TAGS.has(tagName)
            ? `${tagName} call site is missing a label or accessible name.`
            : "Form control is missing a label or accessible name.",
        });
      });
    }

    if (failures.length > 0) {
      return {
        evidence: failures,
        remediation:
          "Associate the control with a `<label htmlFor>`, `FieldLabel`, or accessible name, or add `<FormLabel>` inside the nearest shadcn `<FormItem>`.",
        status: "fail",
      };
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
