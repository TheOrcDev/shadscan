import {
  type CallExpression,
  type Expression,
  isArrowFunction,
  isBinaryExpression,
  isBlock,
  isCallExpression,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isIfStatement,
  isParenthesizedExpression,
  isReturnStatement,
  isThrowStatement,
  isVariableDeclaration,
  type Node,
  SyntaxKind,
} from "typescript";
import { type ParsedSourceFile, type SourceScope, walkNodes } from "../ast";

const TYPING_TARGET_PATTERN =
  /(?:INPUT|TEXTAREA|SELECT|isContentEditable|closest\(\s*["'][^"']*(?:input|textarea|select))/i;
const TARGET_ARGUMENT_PATTERN = /\btarget\b/;

interface TargetPredicateCall {
  call: CallExpression;
  name: string;
}

const isFunctionNode = (node: Node): boolean =>
  isArrowFunction(node) ||
  isFunctionDeclaration(node) ||
  isFunctionExpression(node);

const resolveLocalFunction = (
  file: ParsedSourceFile,
  name: string,
  referencePosition: number
): Node | null => {
  const declarations: Node[] = [];

  walkNodes(file.sourceFile, (node) => {
    if (isFunctionDeclaration(node) && node.name?.text === name) {
      declarations.push(node);
      return;
    }

    if (
      isVariableDeclaration(node) &&
      isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      isFunctionNode(node.initializer) &&
      node.getStart(file.sourceFile) <= referencePosition
    ) {
      declarations.push(node.initializer);
    }
  });

  return (
    declarations.sort(
      (left, right) =>
        Math.abs(left.getStart(file.sourceFile) - referencePosition) -
        Math.abs(right.getStart(file.sourceFile) - referencePosition)
    )[0] ?? null
  );
};

const statementExits = (node: Node): boolean => {
  if (isReturnStatement(node) || isThrowStatement(node)) {
    return true;
  }

  return (
    isBlock(node) &&
    node.statements.some(
      (statement) => isReturnStatement(statement) || isThrowStatement(statement)
    )
  );
};

const getPositiveTargetPredicateCalls = (
  file: ParsedSourceFile,
  condition: Expression
): TargetPredicateCall[] => {
  if (isParenthesizedExpression(condition)) {
    return getPositiveTargetPredicateCalls(file, condition.expression);
  }

  if (
    isBinaryExpression(condition) &&
    condition.operatorToken.kind === SyntaxKind.BarBarToken
  ) {
    return [
      ...getPositiveTargetPredicateCalls(file, condition.left),
      ...getPositiveTargetPredicateCalls(file, condition.right),
    ];
  }

  if (
    !(
      isCallExpression(condition) &&
      isIdentifier(condition.expression) &&
      condition.arguments.some((argument) =>
        TARGET_ARGUMENT_PATTERN.test(argument.getText(file.sourceFile))
      )
    )
  ) {
    return [];
  }

  return [{ call: condition, name: condition.expression.text }];
};

const rangeHasTypingTargetGuard = (
  file: ParsedSourceFile,
  content: string,
  start: number,
  end: number
): boolean => {
  if (TYPING_TARGET_PATTERN.test(content)) {
    return true;
  }

  let hasGuard = false;

  walkNodes(file.sourceFile, (node) => {
    if (
      hasGuard ||
      !isIfStatement(node) ||
      node.getStart(file.sourceFile) < start ||
      node.getEnd() > end ||
      !statementExits(node.thenStatement)
    ) {
      return;
    }

    for (const { call, name } of getPositiveTargetPredicateCalls(
      file,
      node.expression
    )) {
      const predicate = resolveLocalFunction(
        file,
        name,
        call.getStart(file.sourceFile)
      );

      if (
        predicate &&
        TYPING_TARGET_PATTERN.test(predicate.getText(file.sourceFile))
      ) {
        hasGuard = true;
        return;
      }
    }
  });

  return hasGuard;
};

const nodeHasTypingTargetGuard = (
  file: ParsedSourceFile,
  node: Node
): boolean =>
  rangeHasTypingTargetGuard(
    file,
    node.getText(file.sourceFile),
    node.getStart(file.sourceFile),
    node.getEnd()
  );

const sourceScopeHasTypingTargetGuard = (scope: SourceScope): boolean =>
  rangeHasTypingTargetGuard(scope.file, scope.content, scope.start, scope.end);

export { nodeHasTypingTargetGuard, sourceScopeHasTypingTargetGuard };
