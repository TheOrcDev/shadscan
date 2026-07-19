import {
  type ArrowFunction,
  type BindingName,
  type CallExpression,
  type Expression,
  type FunctionDeclaration,
  type FunctionExpression,
  isArrayBindingPattern,
  isArrayLiteralExpression,
  isArrowFunction,
  isAsExpression,
  isBlock,
  isCallExpression,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isMethodDeclaration,
  isNoSubstitutionTemplateLiteral,
  isObjectBindingPattern,
  isObjectLiteralExpression,
  isOmittedExpression,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isSatisfiesExpression,
  isSpreadAssignment,
  isStringLiteral,
  isVariableDeclaration,
  type MethodDeclaration,
  type Node,
} from "typescript";
import type { EvidenceState } from "./ast";
import { walkNodes } from "./ast";

type MapCallback = ArrowFunction | FunctionExpression;
type FunctionOwner =
  | ArrowFunction
  | FunctionDeclaration
  | FunctionExpression
  | MethodDeclaration;

interface MapContext {
  call: CallExpression;
  callback: MapCallback;
  source: Expression;
}

const unwrapExpression = (expression: Expression): Expression => {
  let current = expression;

  while (
    isAsExpression(current) ||
    isParenthesizedExpression(current) ||
    isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }

  return current;
};

const getMapContext = (expression: Expression): MapContext | null => {
  let current: Node | undefined = expression.parent;

  while (current) {
    if (isArrowFunction(current) || isFunctionExpression(current)) {
      const call: Node = current.parent;

      if (
        isCallExpression(call) &&
        call.arguments[0] === current &&
        isPropertyAccessExpression(call.expression) &&
        call.expression.name.text === "map"
      ) {
        return {
          callback: current,
          call,
          source: call.expression.expression,
        };
      }
    }

    current = current.parent;
  }

  return null;
};

const isFunctionOwner = (node: Node): node is FunctionOwner =>
  isArrowFunction(node) ||
  isFunctionDeclaration(node) ||
  isFunctionExpression(node) ||
  isMethodDeclaration(node);

const getFunctionOwner = (node: Node): FunctionOwner | null => {
  let current: Node | undefined = node.parent;

  while (current) {
    if (isFunctionOwner(current)) {
      return current;
    }

    current = current.parent;
  }

  return null;
};

const bindingContainsName = (binding: BindingName, name: string): boolean => {
  if (isIdentifier(binding)) {
    return binding.text === name;
  }

  if (!(isArrayBindingPattern(binding) || isObjectBindingPattern(binding))) {
    return false;
  }

  return binding.elements.some((element) => {
    if (isOmittedExpression(element) || element.dotDotDotToken) {
      return false;
    }

    return bindingContainsName(element.name, name);
  });
};

const functionParameterShadowsName = (
  owner: FunctionOwner | null,
  name: string
): boolean =>
  owner?.parameters.some((parameter) =>
    bindingContainsName(parameter.name, name)
  ) ?? false;

const isDeclarationVisibleAtCall = (
  declaration: Node,
  call: CallExpression,
  callOwner: FunctionOwner | null
): boolean => {
  const declarationOwner = getFunctionOwner(declaration);

  if (declarationOwner && declarationOwner !== callOwner) {
    return false;
  }

  let current: Node | undefined = declaration.parent;

  while (current && current !== declarationOwner) {
    if (
      isBlock(current) &&
      !(
        current.getStart(call.getSourceFile()) <= call.getStart() &&
        current.getEnd() >= call.getEnd()
      )
    ) {
      return false;
    }

    current = current.parent;
  }

  return true;
};

const getPropertyName = (
  expression: Expression,
  callback: MapCallback
): string | null => {
  const parameter = callback.parameters[0];

  if (!parameter) {
    return null;
  }

  if (
    isIdentifier(parameter.name) &&
    isPropertyAccessExpression(expression) &&
    isIdentifier(expression.expression) &&
    expression.expression.text === parameter.name.text
  ) {
    return expression.name.text;
  }

  if (!(isObjectBindingPattern(parameter.name) && isIdentifier(expression))) {
    return null;
  }

  for (const element of parameter.name.elements) {
    if (
      element.dotDotDotToken ||
      !isIdentifier(element.name) ||
      element.name.text !== expression.text
    ) {
      continue;
    }

    const propertyName = element.propertyName ?? element.name;

    if (isIdentifier(propertyName) || isStringLiteral(propertyName)) {
      return propertyName.text;
    }
  }

  return null;
};

const getStaticArray = (
  source: Expression,
  call: CallExpression
): Expression[] | null => {
  const unwrappedSource = unwrapExpression(source);

  if (isArrayLiteralExpression(unwrappedSource)) {
    return [...unwrappedSource.elements];
  }

  if (!isIdentifier(unwrappedSource)) {
    return null;
  }

  const callOwner = getFunctionOwner(call);
  const sourceName = unwrappedSource.text;

  if (functionParameterShadowsName(callOwner, sourceName)) {
    return null;
  }

  let nearestInitializer: Expression | null = null;
  let nearestPosition = -1;
  const sourceFile = call.getSourceFile();

  walkNodes(sourceFile, (node) => {
    if (
      !(isVariableDeclaration(node) && isIdentifier(node.name)) ||
      node.name.text !== sourceName ||
      !node.initializer ||
      !isDeclarationVisibleAtCall(node, call, callOwner)
    ) {
      return;
    }

    const position = node.getStart(sourceFile);

    if (position < call.getStart(sourceFile) && position > nearestPosition) {
      nearestInitializer = node.initializer;
      nearestPosition = position;
    }
  });

  if (!nearestInitializer) {
    return null;
  }

  const initializer = unwrapExpression(nearestInitializer);
  return isArrayLiteralExpression(initializer)
    ? [...initializer.elements]
    : null;
};

const getObjectPropertyState = (
  expression: Expression,
  propertyName: string
): EvidenceState => {
  const object = unwrapExpression(expression);

  if (!isObjectLiteralExpression(object)) {
    return "unknown";
  }

  for (const property of object.properties) {
    if (
      !(
        isPropertyAssignment(property) &&
        (isIdentifier(property.name) ||
          isStringLiteral(property.name) ||
          isNoSubstitutionTemplateLiteral(property.name))
      ) ||
      property.name.text !== propertyName
    ) {
      continue;
    }

    const value = unwrapExpression(property.initializer);

    if (isStringLiteral(value) || isNoSubstitutionTemplateLiteral(value)) {
      return value.text.trim().length > 0 ? "valid" : "invalid";
    }

    return "unknown";
  }

  return object.properties.some((property) => isSpreadAssignment(property))
    ? "unknown"
    : "invalid";
};

const getStaticMappedTextState = (expression: Expression): EvidenceState => {
  const context = getMapContext(expression);

  if (!context) {
    return "unknown";
  }

  const propertyName = getPropertyName(expression, context.callback);
  const elements = getStaticArray(context.source, context.call);

  if (!(propertyName && elements)) {
    return "unknown";
  }

  const states = elements.map((element) =>
    getObjectPropertyState(element, propertyName)
  );

  if (states.every((state) => state === "valid")) {
    return "valid";
  }

  return states.every((state) => state !== "unknown") ? "invalid" : "unknown";
};

export { getStaticMappedTextState };
