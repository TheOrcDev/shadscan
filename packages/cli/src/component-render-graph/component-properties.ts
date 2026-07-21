import {
  type BindingName,
  type Expression,
  isArrayBindingPattern,
  isBindingElement,
  isIdentifier,
  isJsxAttribute,
  isJsxExpression,
  isJsxSpreadAttribute,
  isObjectBindingPattern,
  isPropertyAccessExpression,
  type JsxOpeningLikeElement,
} from "typescript";
import { walkNodes } from "../ast";
import { compareCodeUnits } from "../deterministic-order";
import type { ChildrenBindings, SupportedFunction } from "./types";

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

  for (const element of parameter.elements) {
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

const jsxNodeForwardsClassName = (
  node: JsxOpeningLikeElement,
  bindings: ChildrenBindings
): boolean =>
  node.attributes.properties.some(
    (property) =>
      isJsxAttribute(property) &&
      ["class", "className"].includes(property.name.getText()) &&
      property.initializer &&
      isJsxExpression(property.initializer) &&
      Boolean(
        property.initializer.expression &&
          expressionMatchesProp(
            property.initializer.expression,
            bindings,
            "className"
          )
      )
  );

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
  expressionProjectsChildren,
  getChildrenBindings,
  getNamedSlotBindings,
  getPropBindings,
  jsxNodeForwardsClassName,
};
