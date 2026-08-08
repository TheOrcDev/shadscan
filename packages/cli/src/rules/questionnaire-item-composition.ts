import {
  forEachChild,
  isJsxElement,
  isJsxSelfClosingElement,
  type JsxOpeningLikeElement,
  type Node,
} from "typescript";
import {
  collectUiModuleImports,
  resolveUiTagName,
  type UiModuleImports,
} from "../anatomy";
import {
  getJsxAttributeValue,
  getJsxTagName,
  getLineNumber,
  type ParsedSourceFile,
  parseProjectSourceFiles,
} from "../ast";
import type { AuditRule } from "../audit";
import { advisory, notApplicable, pass } from "./rule-result";

/**
 * shadcn's questionnaire is a thin styling wrapper over the headless
 * `@shadcn/react/questionnaire` primitive: the copied file holds Tailwind
 * classes and data-slots, while focus movement, aria wiring and error
 * association live in the primitive. So this rule checks only what the caller
 * actually composes, and deliberately says nothing about behavior the
 * primitive owns — auditing that would mean auditing someone else's package,
 * and would break on every release of it.
 *
 * Two things the caller can get wrong, both measured against shadcn's own
 * questionnaire-example:
 *
 * - An item with no title is an unlabelled question (7 of 7 items in the
 *   example have one).
 * - A required item with no error slot fails validation with nowhere to say
 *   so: the user presses Next, nothing moves, and nothing explains why (5 of
 *   5 required items in the example render an error).
 *
 * Resolution is by part name, so if the pre-1.0 primitive renames a part this
 * rule goes quiet rather than failing loudly. That is the intended direction
 * for an advisory check, but it is worth knowing when wondering why it stopped
 * reporting.
 */

const QUESTIONNAIRE_MODULE = "questionnaire";
const ITEM_PART = "QuestionnaireItem";
const TITLE_PART = "QuestionnaireTitle";
const ERROR_PART = "QuestionnaireError";

interface ItemViolation {
  kind: "missing-error" | "missing-title";
  line: number;
}

const getOpeningElement = (node: Node): JsxOpeningLikeElement | null => {
  if (isJsxSelfClosingElement(node)) {
    return node;
  }

  return isJsxElement(node) ? node.openingElement : null;
};

const resolvesTo = (
  element: JsxOpeningLikeElement,
  part: string,
  imports: UiModuleImports
): boolean => {
  const tagName = getJsxTagName(element);

  return Boolean(tagName && resolveUiTagName(tagName, imports) === part);
};

/**
 * Descends the whole subtree rather than reading direct children: parts are
 * routinely wrapped in a layout element or a form primitive, and a
 * direct-children scan would miss them.
 */
const hasDescendantPart = (
  root: Node,
  part: string,
  imports: UiModuleImports
): boolean => {
  let found = false;

  const visit = (node: Node): void => {
    if (found) {
      return;
    }

    const element = getOpeningElement(node);

    if (element && resolvesTo(element, part, imports)) {
      found = true;
      return;
    }

    forEachChild(node, visit);
  };

  forEachChild(root, visit);
  return found;
};

/**
 * A bare `required` reads as static true. `required={maybe}` reads as dynamic,
 * and is treated as not required: for an advisory rule a false positive costs
 * more than a miss.
 */
const isStaticallyRequired = (element: JsxOpeningLikeElement): boolean => {
  const required = getJsxAttributeValue(element, "required");

  return required.kind === "static" && required.value === true;
};

const inspectItem = (
  node: Node,
  element: JsxOpeningLikeElement,
  file: ParsedSourceFile,
  imports: UiModuleImports
): ItemViolation | null => {
  const line = getLineNumber(file, element);

  // The missing label is the more fundamental problem, so it wins the report.
  if (!hasDescendantPart(node, TITLE_PART, imports)) {
    return { kind: "missing-title", line };
  }

  if (
    isStaticallyRequired(element) &&
    !hasDescendantPart(node, ERROR_PART, imports)
  ) {
    return { kind: "missing-error", line };
  }

  return null;
};

const scanFile = (
  file: ParsedSourceFile,
  uiAlias: string | undefined
): { itemCount: number; violation: ItemViolation | null } => {
  const imports = collectUiModuleImports(
    file.sourceFile,
    uiAlias,
    QUESTIONNAIRE_MODULE
  );

  if (imports.locals.size === 0 && imports.namespaces.size === 0) {
    return { itemCount: 0, violation: null };
  }

  let itemCount = 0;
  let violation: ItemViolation | null = null;

  const visit = (node: Node): void => {
    const element = getOpeningElement(node);

    if (element && resolvesTo(element, ITEM_PART, imports)) {
      itemCount += 1;
      violation ??= inspectItem(node, element, file, imports);
    }

    forEachChild(node, visit);
  };

  forEachChild(file.sourceFile, visit);
  return { itemCount, violation };
};

const VIOLATION_COPY = {
  "missing-error": {
    message:
      "A required questionnaire item has no QuestionnaireError, so a failed answer has nowhere to explain itself.",
    remediation:
      "Add <QuestionnaireError /> inside the item so a validation failure is visible instead of the form silently refusing to advance.",
  },
  "missing-title": {
    message:
      "A questionnaire item has no QuestionnaireTitle, so the question is unlabelled.",
    remediation:
      "Add a <QuestionnaireTitle> naming the question, so the item reads as a question rather than a bare set of choices.",
  },
} as const;

const questionnaireItemCompositionRule: AuditRule = {
  adapters: ["core"],
  category: "forms",
  confidence: "medium",
  description:
    "Checks that questionnaire items carry a title, and that required items can render their validation error.",
  id: "questionnaire-item-composition",
  maxScore: 0,
  run: async ({ project }) => {
    if (!project.shadcn.configPath) {
      return notApplicable("No valid shadcn configuration was found.");
    }

    const files = await parseProjectSourceFiles(project);
    const uiAlias = project.shadcn.aliases.ui;
    let itemCount = 0;

    for (const file of files) {
      const scan = scanFile(file, uiAlias);
      itemCount += scan.itemCount;

      if (scan.violation) {
        const copy = VIOLATION_COPY[scan.violation.kind];

        return advisory(
          copy.message,
          copy.remediation,
          file.filePath,
          scan.violation.line
        );
      }
    }

    if (itemCount === 0) {
      return notApplicable("No questionnaire items were found.");
    }

    return pass(
      `All ${itemCount} questionnaire items carry a title, and every required item can render its error.`
    );
  },
  severity: "warning",
  title: "questionnaire items are composed completely",
};

export { questionnaireItemCompositionRule };
