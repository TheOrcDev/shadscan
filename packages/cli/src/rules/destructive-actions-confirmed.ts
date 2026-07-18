import {
  isArrowFunction,
  isFunctionDeclaration,
  isFunctionExpression,
  isJsxAttribute,
  isJsxElement,
  isJsxSelfClosingElement,
  isMethodDeclaration,
  type JsxElement,
  type JsxOpeningLikeElement,
  type Node,
} from "typescript";
import {
  getJsxAttributeValue,
  getJsxTagName,
  getLineNumber,
  type ParsedSourceFile,
  parseProjectSourceFiles,
  visitJsxNodes,
} from "../ast";
import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";

const ACTION_COMPONENT_PATTERN = /(?:Button|CommandItem|MenuItem|Action)$/;
const ACTION_HANDLER_ATTRIBUTES = new Set([
  "action",
  "formAction",
  "onClick",
  "onSelect",
  "onSubmit",
]);
const ACTION_ROLES = new Set(["button", "menuitem"]);
const DESTRUCTIVE_NAME_PATTERN =
  /\b(?:delete|destroy|erase|remove|revoke)\w*\b/i;
const CONFIRMATION_OR_UNDO_PATTERN =
  /\b(?:AlertDialog|ConfirmDialog|ConfirmationDialog|Undo)\b|(?:window\.)?confirm\s*\(/i;
const GENERATED_UI_PATH_PATTERN = /[/\\]components[/\\]ui[/\\]/;

interface DestructiveAction {
  file: ParsedSourceFile;
  line: number;
  owner: Node;
}

const isFunctionOwner = (node: Node): boolean =>
  isArrowFunction(node) ||
  isFunctionDeclaration(node) ||
  isFunctionExpression(node) ||
  isMethodDeclaration(node);

const getOwner = (file: ParsedSourceFile, ancestors: Node[]): Node =>
  ancestors.find((ancestor) => isFunctionOwner(ancestor)) ?? file.sourceFile;

const getOpeningElement = (
  node: JsxElement | JsxOpeningLikeElement
): JsxOpeningLikeElement => (isJsxElement(node) ? node.openingElement : node);

const hasActionHandler = (node: JsxOpeningLikeElement): boolean =>
  node.attributes.properties.some(
    (property) =>
      isJsxAttribute(property) &&
      ACTION_HANDLER_ATTRIBUTES.has(property.name.getText())
  );

const hasActionRole = (node: JsxOpeningLikeElement): boolean => {
  const role = getJsxAttributeValue(node, "role");

  return (
    role.kind === "static" &&
    typeof role.value === "string" &&
    ACTION_ROLES.has(role.value.trim().toLowerCase())
  );
};

const isNativeSubmitInput = (
  node: JsxOpeningLikeElement,
  tagName: string
): boolean => {
  if (tagName !== "input") {
    return false;
  }

  const type = getJsxAttributeValue(node, "type");

  return (
    type.kind === "static" &&
    typeof type.value === "string" &&
    ["button", "submit"].includes(type.value.trim().toLowerCase())
  );
};

const isActionSurface = (
  node: JsxOpeningLikeElement,
  tagName: string
): boolean =>
  tagName === "button" ||
  ACTION_COMPONENT_PATTERN.test(tagName) ||
  isNativeSubmitInput(node, tagName) ||
  hasActionRole(node) ||
  hasActionHandler(node);

const hasDestructiveEvidence = (
  file: ParsedSourceFile,
  node: JsxElement | JsxOpeningLikeElement,
  openingElement: JsxOpeningLikeElement
): boolean => {
  const variant = getJsxAttributeValue(openingElement, "variant");
  const hasDestructiveVariant =
    variant.kind === "static" &&
    typeof variant.value === "string" &&
    variant.value.trim().toLowerCase() === "destructive";

  return (
    hasDestructiveVariant ||
    DESTRUCTIVE_NAME_PATTERN.test(node.getText(file.sourceFile))
  );
};

const findDestructiveActions = (
  files: ParsedSourceFile[]
): DestructiveAction[] => {
  const actions: DestructiveAction[] = [];

  visitJsxNodes(files, ({ ancestors, file, node }) => {
    if (!(isJsxElement(node) || isJsxSelfClosingElement(node))) {
      return;
    }

    const openingElement = getOpeningElement(node);
    const tagName = getJsxTagName(openingElement);

    if (
      !(
        tagName &&
        isActionSurface(openingElement, tagName) &&
        hasDestructiveEvidence(file, node, openingElement)
      )
    ) {
      return;
    }

    actions.push({
      file,
      line: getLineNumber(file, openingElement),
      owner: getOwner(file, ancestors),
    });
  });

  return actions;
};

const hasCorrelatedSafeguard = (action: DestructiveAction): boolean =>
  CONFIRMATION_OR_UNDO_PATTERN.test(
    action.owner.getText(action.file.sourceFile)
  );

const destructiveActionsConfirmedRule: AuditRule = {
  adapters: ["core"],
  category: "interaction",
  confidence: "low",
  description:
    "Looks for correlated confirmation or undo affordances around structurally detected destructive actions.",
  id: "destructive-actions-confirmed",
  maxScore: 0,
  run: async ({ project }) => {
    const files = (await parseProjectSourceFiles(project)).filter(
      (file) => !GENERATED_UI_PATH_PATTERN.test(file.filePath)
    );
    const actions = findDestructiveActions(files);

    if (actions.length === 0) {
      return notApplicable("No destructive app-level action was found.");
    }

    const unsafeAction = actions.find(
      (action) => !hasCorrelatedSafeguard(action)
    );

    if (unsafeAction) {
      return fail(
        "A destructive action was found without correlated confirmation or undo evidence.",
        "Add a focused confirmation dialog or a reliable undo path, then exercise the complete destructive flow in a browser.",
        {
          filePath: unsafeAction.file.filePath,
          line: unsafeAction.line,
        }
      );
    }

    const safeguardedAction = actions[0];

    return pass(
      "Correlated confirmation or undo evidence accompanies destructive actions.",
      safeguardedAction?.file.filePath,
      safeguardedAction?.line
    );
  },
  severity: "warning",
  title: "destructive actions are confirmed or reversible",
};

export { destructiveActionsConfirmedRule };
