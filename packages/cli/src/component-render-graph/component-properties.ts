import {
  type BindingName,
  type Expression,
  isArrayBindingPattern,
  isBinaryExpression,
  isBindingElement,
  isCallExpression,
  isIdentifier,
  isJsxAttribute,
  isJsxExpression,
  isJsxSpreadAttribute,
  isNoSubstitutionTemplateLiteral,
  isObjectBindingPattern,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isStringLiteral,
  type JsxOpeningLikeElement,
  SyntaxKind,
} from "typescript";
import { walkNodes } from "../ast";
import { compareCodeUnits } from "../deterministic-order";
import { getResponsiveVisibilityFromClassNames } from "../rules/responsive-visibility";
import type { ChildrenBindings, SupportedFunction } from "./types";

interface ClassNameForwardingInfo {
  forwards: boolean;
  staticClassNames: string[] | null;
}

const CLASS_NAME_HELPERS = new Set(["classNames", "classnames", "clsx", "cn"]);
const CLASS_SEPARATOR_PATTERN = /\s+/;

const getPropBindings = (
  declaration: SupportedFunction,
  propName: string
): ChildrenBindings => {
  const bindings: ChildrenBindings = {
    objectName: null,
    valueNames: new Set<string>(),
  };
  const parameter = declaration.parameters[0]?.name;

  if (!parameter) {
    return bindings;
  }

  if (isIdentifier(parameter)) {
    bindings.objectName = parameter.text;
    return bindings;
  }

  if (!isObjectBindingPattern(parameter)) {
    return bindings;
  }

  const explicitlyBindsProp = parameter.elements.some((element) => {
    if (element.dotDotDotToken || !isIdentifier(element.name)) {
      return false;
    }

    return (element.propertyName?.getText() ?? element.name.text) === propName;
  });

  for (const element of parameter.elements) {
    if (
      element.dotDotDotToken &&
      isIdentifier(element.name) &&
      !explicitlyBindsProp
    ) {
      bindings.objectName = element.name.text;
      continue;
    }

    const propertyName = element.propertyName?.getText();
    const bindingName = isIdentifier(element.name) ? element.name.text : null;

    if (bindingName && (propertyName ?? bindingName) === propName) {
      bindings.valueNames.add(bindingName);
    }
  }

  return bindings;
};

const getChildrenBindings = (
  declaration: SupportedFunction
): ChildrenBindings => getPropBindings(declaration, "children");

const getNamedSlotBindings = (declaration: SupportedFunction): string[] => {
  const parameter = declaration.parameters[0]?.name;
  if (!(parameter && isObjectBindingPattern(parameter))) {
    return [];
  }

  return parameter.elements
    .map((element) => element.propertyName?.getText() ?? element.name.getText())
    .filter((name) => name !== "children" && name !== "params")
    .sort(compareCodeUnits);
};

const bindingContainsName = (
  binding: BindingName,
  targetName: string
): boolean => {
  if (isIdentifier(binding)) {
    return binding.text === targetName;
  }

  if (isObjectBindingPattern(binding) || isArrayBindingPattern(binding)) {
    return binding.elements.some(
      (element) =>
        isBindingElement(element) &&
        bindingContainsName(element.name, targetName)
    );
  }

  return false;
};

const declarationBindsComponentName = (
  declaration: SupportedFunction,
  tagName: string
): boolean => {
  const rootName = tagName.split(".")[0];
  return Boolean(
    rootName &&
      declaration.parameters.some((parameter) =>
        bindingContainsName(parameter.name, rootName)
      )
  );
};

const declarationBindsValueName = (
  declaration: SupportedFunction,
  valueName: string
): boolean =>
  declaration.parameters.some((parameter) =>
    bindingContainsName(parameter.name, valueName)
  );

const expressionMatchesProp = (
  expression: Expression,
  bindings: ChildrenBindings,
  propName: string
): boolean => {
  if (isIdentifier(expression)) {
    return bindings.valueNames.has(expression.text);
  }

  return (
    Boolean(bindings.objectName) &&
    isPropertyAccessExpression(expression) &&
    isIdentifier(expression.expression) &&
    expression.expression.text === bindings.objectName &&
    expression.name.text === propName
  );
};

const expressionProjectsChildren = (
  expression: Expression,
  bindings: ChildrenBindings
): boolean => expressionMatchesProp(expression, bindings, "children");

const getHelperName = (expression: Expression): string | null => {
  if (isIdentifier(expression)) {
    return expression.text;
  }

  return isPropertyAccessExpression(expression) ? expression.name.text : null;
};

const getClassNameExpressionInfo = (
  expression: Expression,
  bindings: ChildrenBindings
): ClassNameForwardingInfo => {
  if (isParenthesizedExpression(expression)) {
    return getClassNameExpressionInfo(expression.expression, bindings);
  }

  if (expressionMatchesProp(expression, bindings, "className")) {
    return { forwards: true, staticClassNames: [] };
  }

  if (
    isStringLiteral(expression) ||
    isNoSubstitutionTemplateLiteral(expression)
  ) {
    return {
      forwards: false,
      staticClassNames: expression.text
        .split(CLASS_SEPARATOR_PATTERN)
        .filter(Boolean),
    };
  }

  if (
    isBinaryExpression(expression) &&
    expression.operatorToken.kind === SyntaxKind.AmpersandAmpersandToken
  ) {
    const rightInfo = getClassNameExpressionInfo(expression.right, bindings);
    const hasOnlyVisibleEffects =
      rightInfo.staticClassNames !== null &&
      getResponsiveVisibilityFromClassNames(
        rightInfo.staticClassNames
      ).bands.every((band) => band === "visible");

    return {
      forwards: false,
      staticClassNames: hasOnlyVisibleEffects ? [] : null,
    };
  }

  if (
    !(
      isCallExpression(expression) &&
      CLASS_NAME_HELPERS.has(getHelperName(expression.expression) ?? "")
    )
  ) {
    return { forwards: false, staticClassNames: null };
  }

  let forwards = false;
  let staticClassNames: string[] | null = [];

  for (const argument of expression.arguments) {
    const argumentInfo = getClassNameExpressionInfo(argument, bindings);
    forwards ||= argumentInfo.forwards;

    if (!(staticClassNames && argumentInfo.staticClassNames)) {
      staticClassNames = null;
      continue;
    }

    staticClassNames.push(...argumentInfo.staticClassNames);
  }

  return { forwards, staticClassNames };
};

const getJsxClassNameForwarding = (
  node: JsxOpeningLikeElement,
  bindings: ChildrenBindings
): ClassNameForwardingInfo => {
  for (const property of node.attributes.properties) {
    if (
      !(
        isJsxAttribute(property) &&
        ["class", "className"].includes(property.name.getText()) &&
        property.initializer &&
        isJsxExpression(property.initializer) &&
        property.initializer.expression
      )
    ) {
      continue;
    }

    return getClassNameExpressionInfo(
      property.initializer.expression,
      bindings
    );
  }

  return { forwards: false, staticClassNames: [] };
};

const jsxNodeForwardsClassName = (
  node: JsxOpeningLikeElement,
  bindings: ChildrenBindings
): boolean => getJsxClassNameForwarding(node, bindings).forwards;

const bodyMayReferenceProp = (
  declaration: SupportedFunction,
  bindings: ChildrenBindings,
  propName: string
): boolean => {
  const body = declaration.body;

  if (!body) {
    return false;
  }

  let found = false;
  walkNodes(body, (candidate) => {
    if (found) {
      return;
    }

    if (isIdentifier(candidate) && bindings.valueNames.has(candidate.text)) {
      found = true;
      return;
    }

    if (
      bindings.objectName &&
      isJsxSpreadAttribute(candidate) &&
      isIdentifier(candidate.expression) &&
      candidate.expression.text === bindings.objectName
    ) {
      found = true;
      return;
    }

    if (
      bindings.objectName &&
      isPropertyAccessExpression(candidate) &&
      isIdentifier(candidate.expression) &&
      candidate.expression.text === bindings.objectName &&
      candidate.name.text === propName
    ) {
      found = true;
    }
  });

  if (found) {
    return true;
  }

  const bodyText = body.getText();
  return (
    bodyText.includes(propName) &&
    (bindings.objectName !== null || bindings.valueNames.size > 0)
  );
};

export {
  bodyMayReferenceProp,
  declarationBindsComponentName,
  declarationBindsValueName,
  expressionProjectsChildren,
  getChildrenBindings,
  getJsxClassNameForwarding,
  getNamedSlotBindings,
  getPropBindings,
  jsxNodeForwardsClassName,
};
