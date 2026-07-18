import {
  isArrowFunction,
  isCallExpression,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isIfStatement,
  isPropertyAccessExpression,
  isStringLiteral,
  isVariableDeclaration,
  type Node,
} from "typescript";
import {
  getLineNumber,
  type ParsedSourceFile,
  parseProjectSourceFiles,
  walkNodes,
} from "../ast";
import type { AuditRule } from "../audit";
import { fail, pass } from "./rule-result";
import { nodeHasTypingTargetGuard } from "./typing-target-guard";

const BARE_KEY_PATTERN =
  /(?:key\.toLowerCase\(\)|key)\s*(?:===|!==)\s*["'][a-z]["']/i;
const MODIFIER_PATTERN = /(?:metaKey|ctrlKey|altKey)/;
const ABORT_SIGNAL_PATTERN = /\bsignal\s*:/;

interface GlobalKeydownListener {
  call: Node;
  handler: Node | null;
  handlerName: string | null;
  owner: Node;
  target: "document" | "window";
}

const isFunctionNode = (node: Node): boolean =>
  isArrowFunction(node) ||
  isFunctionDeclaration(node) ||
  isFunctionExpression(node);

const getOwner = (file: ParsedSourceFile, ancestors: Node[]): Node =>
  ancestors.find((ancestor) => isFunctionNode(ancestor)) ?? file.sourceFile;

const resolveHandler = (
  file: ParsedSourceFile,
  handlerName: string,
  listenerPosition: number
): Node | null => {
  const declarations: Node[] = [];

  walkNodes(file.sourceFile, (node) => {
    if (
      isFunctionDeclaration(node) &&
      node.name?.text === handlerName &&
      node.getStart(file.sourceFile) <= listenerPosition
    ) {
      declarations.push(node);
      return;
    }

    if (
      isVariableDeclaration(node) &&
      isIdentifier(node.name) &&
      node.name.text === handlerName &&
      node.initializer &&
      (isArrowFunction(node.initializer) ||
        isFunctionExpression(node.initializer)) &&
      node.getStart(file.sourceFile) <= listenerPosition
    ) {
      declarations.push(node.initializer);
    }
  });

  return (
    declarations.sort(
      (left, right) =>
        right.getStart(file.sourceFile) - left.getStart(file.sourceFile)
    )[0] ?? null
  );
};

const getGlobalKeydownListeners = (
  file: ParsedSourceFile
): GlobalKeydownListener[] => {
  const listeners: GlobalKeydownListener[] = [];

  walkNodes(file.sourceFile, (node, ancestors) => {
    if (
      !(
        isCallExpression(node) && isPropertyAccessExpression(node.expression)
      ) ||
      node.expression.name.text !== "addEventListener"
    ) {
      return;
    }

    const targetText = node.expression.expression.getText(file.sourceFile);
    const eventName = node.arguments[0];
    const handlerArgument = node.arguments[1];

    if (
      (targetText !== "document" && targetText !== "window") ||
      !eventName ||
      !isStringLiteral(eventName) ||
      eventName.text !== "keydown" ||
      !handlerArgument
    ) {
      return;
    }

    const handlerName = isIdentifier(handlerArgument)
      ? handlerArgument.text
      : null;
    let handler: Node | null = null;

    if (
      isArrowFunction(handlerArgument) ||
      isFunctionExpression(handlerArgument)
    ) {
      handler = handlerArgument;
    } else if (handlerName) {
      handler = resolveHandler(
        file,
        handlerName,
        node.getStart(file.sourceFile)
      );
    }

    listeners.push({
      call: node,
      handler,
      handlerName,
      owner: getOwner(file, ancestors),
      target: targetText,
    });
  });

  return listeners;
};

const hasMatchingCleanup = (
  file: ParsedSourceFile,
  listener: GlobalKeydownListener
): boolean => {
  if (ABORT_SIGNAL_PATTERN.test(listener.call.getText(file.sourceFile))) {
    return true;
  }

  if (!listener.handlerName) {
    return false;
  }

  const ownerText = listener.owner.getText(file.sourceFile);
  const escapedHandlerName = listener.handlerName.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
  const cleanupPattern = new RegExp(
    `${listener.target}\\.removeEventListener\\(\\s*["']keydown["']\\s*,\\s*${escapedHandlerName}\\b`
  );

  return cleanupPattern.test(ownerText);
};

const getUnsafeBareKey = (
  file: ParsedSourceFile,
  handler: Node
): Node | null => {
  const handlerText = handler.getText(file.sourceFile);

  if (nodeHasTypingTargetGuard(file, handler)) {
    return null;
  }

  let unsafeCondition: Node | null = null;

  walkNodes(handler, (node) => {
    if (unsafeCondition || !isIfStatement(node)) {
      return;
    }

    const condition = node.expression.getText(file.sourceFile);

    if (BARE_KEY_PATTERN.test(condition) && !MODIFIER_PATTERN.test(condition)) {
      unsafeCondition = node.expression;
    }
  });

  if (unsafeCondition) {
    return unsafeCondition;
  }

  return BARE_KEY_PATTERN.test(handlerText) &&
    !MODIFIER_PATTERN.test(handlerText)
    ? handler
    : null;
};

const globalHotkeysAreSafeRule: AuditRule = {
  adapters: ["core"],
  category: "interaction",
  confidence: "medium",
  description:
    "Checks global keyboard listeners for cleanup and typing-target guards.",
  id: "global-hotkeys-are-safe",
  maxScore: 3,
  run: async ({ project }) => {
    const files = await parseProjectSourceFiles(project);

    for (const file of files) {
      const listeners = getGlobalKeydownListeners(file);

      for (const listener of listeners) {
        if (!hasMatchingCleanup(file, listener)) {
          return fail(
            "Global keydown listener has no matching cleanup.",
            "Remove the keydown listener with the same target and handler, or register it with an AbortSignal.",
            {
              filePath: file.filePath,
              line: getLineNumber(file, listener.call),
            }
          );
        }

        if (!listener.handler) {
          return fail(
            "Global keydown listener uses a handler that could not be inspected.",
            "Use a local named or inline handler so shortcut safety can be verified.",
            {
              filePath: file.filePath,
              line: getLineNumber(file, listener.call),
            }
          );
        }

        const unsafeBareKey = getUnsafeBareKey(file, listener.handler);

        if (unsafeBareKey) {
          return fail(
            "Bare-key global shortcut can fire while the user is typing.",
            "Ignore input, textarea, select, and contenteditable targets before handling bare-key shortcuts.",
            {
              filePath: file.filePath,
              line: getLineNumber(file, unsafeBareKey),
            }
          );
        }
      }
    }

    return pass("No unsafe global keyboard listeners were found.");
  },
  severity: "warning",
  title: "global keyboard shortcuts are safe",
};

export { globalHotkeysAreSafeRule };
