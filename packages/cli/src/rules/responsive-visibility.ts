import {
  type Expression,
  isBinaryExpression,
  isCallExpression,
  isConditionalExpression,
  isIdentifier,
  isJsxAttribute,
  isJsxElement,
  isJsxExpression,
  isNoSubstitutionTemplateLiteral,
  isParenthesizedExpression,
  isStringLiteral,
  isTemplateExpression,
  type JsxOpeningLikeElement,
  type Node,
  SyntaxKind,
} from "typescript";

type VisibilityState = "hidden" | "unknown" | "visible";
type VisibilityOverlap = boolean | null;

interface ResponsiveVisibility {
  bands: VisibilityState[];
}

interface DisplayEffect {
  bands: number[];
  priority: number;
  visible: boolean;
}

const BREAKPOINTS = ["base", "sm", "md", "lg", "xl", "2xl"] as const;
const DISPLAY_UTILITIES = new Map<string, boolean>([
  ["block", true],
  ["contents", true],
  ["flex", true],
  ["flow-root", true],
  ["grid", true],
  ["hidden", false],
  ["inline", true],
  ["inline-block", true],
  ["inline-flex", true],
  ["inline-grid", true],
  ["table", true],
  ["table-cell", true],
  ["table-row", true],
]);
const CLASS_HELPERS = new Set(["cn", "clsx"]);
const MAX_CLASS_ALTERNATIVES = 32;
const CLASS_SEPARATOR_PATTERN = /\s+/;
const IMPORTANT_PREFIX_PATTERN = /^!/;

const tokenizeClassName = (className: string): string[] =>
  className.split(CLASS_SEPARATOR_PATTERN).filter(Boolean);

const appendAlternatives = (
  leftAlternatives: string[][],
  rightAlternatives: string[][]
): string[][] | null => {
  const combined: string[][] = [];

  for (const left of leftAlternatives) {
    for (const right of rightAlternatives) {
      combined.push([...left, ...right]);

      if (combined.length > MAX_CLASS_ALTERNATIVES) {
        return null;
      }
    }
  }

  return combined;
};

const combineExpressionAlternatives = (
  expressions: readonly Expression[]
): string[][] | null => {
  let alternatives: string[][] = [[]];

  for (const expression of expressions) {
    const expressionAlternatives = getClassAlternatives(expression);

    if (!expressionAlternatives) {
      return null;
    }

    const combined = appendAlternatives(alternatives, expressionAlternatives);

    if (!combined) {
      return null;
    }

    alternatives = combined;
  }

  return alternatives;
};

const getTemplateAlternatives = (
  expression: import("typescript").TemplateExpression
): string[][] | null => {
  let alternatives: string[][] = [tokenizeClassName(expression.head.text)];

  for (const span of expression.templateSpans) {
    const expressionAlternatives = getClassAlternatives(span.expression);

    if (!expressionAlternatives) {
      return null;
    }

    const withExpression = appendAlternatives(
      alternatives,
      expressionAlternatives
    );

    if (!withExpression) {
      return null;
    }

    alternatives = withExpression.map((tokens) => [
      ...tokens,
      ...tokenizeClassName(span.literal.text),
    ]);
  }

  return alternatives;
};

function getClassAlternatives(expression: Expression): string[][] | null {
  if (isParenthesizedExpression(expression)) {
    return getClassAlternatives(expression.expression);
  }

  if (
    isStringLiteral(expression) ||
    isNoSubstitutionTemplateLiteral(expression)
  ) {
    return [tokenizeClassName(expression.text)];
  }

  if (isTemplateExpression(expression)) {
    return getTemplateAlternatives(expression);
  }

  if (isConditionalExpression(expression)) {
    const whenTrue = getClassAlternatives(expression.whenTrue);
    const whenFalse = getClassAlternatives(expression.whenFalse);

    return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : null;
  }

  if (
    isBinaryExpression(expression) &&
    expression.operatorToken.kind === SyntaxKind.AmpersandAmpersandToken
  ) {
    const right = getClassAlternatives(expression.right);
    return right ? [[], ...right] : null;
  }

  if (
    isCallExpression(expression) &&
    isIdentifier(expression.expression) &&
    CLASS_HELPERS.has(expression.expression.text)
  ) {
    return combineExpressionAlternatives(expression.arguments);
  }

  return null;
}

const getTokenEffect = (token: string): DisplayEffect | null => {
  const segments = token.split(":");
  const utility = segments.at(-1)?.replace(IMPORTANT_PREFIX_PATTERN, "");
  const visible = utility ? DISPLAY_UTILITIES.get(utility) : undefined;

  if (visible === undefined) {
    return null;
  }

  const variants = segments.slice(0, -1);

  if (variants.length === 0) {
    return {
      bands: BREAKPOINTS.map((_, index) => index),
      priority: 0,
      visible,
    };
  }

  let bands = BREAKPOINTS.map((_, index) => index);

  for (const variant of variants) {
    const maxBreakpoint = variant.startsWith("max-")
      ? variant.slice("max-".length)
      : null;
    const breakpoint = maxBreakpoint ?? variant;
    const breakpointIndex = BREAKPOINTS.indexOf(
      breakpoint as (typeof BREAKPOINTS)[number]
    );

    if (breakpointIndex <= 0) {
      return null;
    }

    bands = bands.filter((band) =>
      maxBreakpoint ? band < breakpointIndex : band >= breakpointIndex
    );
  }

  return { bands, priority: 1, visible };
};

const getVisibilityForTokens = (tokens: string[]): ResponsiveVisibility => {
  const bands: VisibilityState[] = BREAKPOINTS.map(() => "visible");
  const priorities = BREAKPOINTS.map(() => -1);

  for (const token of tokens) {
    const effect = getTokenEffect(token);

    if (!effect) {
      continue;
    }

    for (const band of effect.bands) {
      if (effect.priority < (priorities[band] ?? -1)) {
        continue;
      }

      priorities[band] = effect.priority;
      bands[band] = effect.visible ? "visible" : "hidden";
    }
  }

  return { bands };
};

const mergeAlternativeVisibility = (
  alternatives: string[][] | null
): ResponsiveVisibility => {
  if (!alternatives) {
    return { bands: BREAKPOINTS.map(() => "unknown") };
  }

  const alternativeBands = alternatives.map(
    (tokens) => getVisibilityForTokens(tokens).bands
  );
  const bands = BREAKPOINTS.map((_, bandIndex): VisibilityState => {
    const states = new Set(
      alternativeBands.map((alternative) => alternative[bandIndex])
    );
    const state = states.values().next().value;
    return states.size === 1 && state ? state : "unknown";
  });

  return { bands };
};

const getClassAlternativesFromNode = (
  node: JsxOpeningLikeElement
): string[][] | null => {
  for (const property of node.attributes.properties) {
    if (
      !(
        isJsxAttribute(property) &&
        ["class", "className"].includes(property.name.getText())
      )
    ) {
      continue;
    }

    if (!property.initializer) {
      return null;
    }

    if (isStringLiteral(property.initializer)) {
      return [tokenizeClassName(property.initializer.text)];
    }

    if (
      isJsxExpression(property.initializer) &&
      property.initializer.expression
    ) {
      return getClassAlternatives(property.initializer.expression);
    }

    return null;
  }

  return [[]];
};

const intersectVisibility = (
  left: ResponsiveVisibility,
  right: ResponsiveVisibility
): ResponsiveVisibility => ({
  bands: left.bands.map((leftState, index): VisibilityState => {
    const rightState = right.bands[index] ?? "unknown";

    if (leftState === "hidden" || rightState === "hidden") {
      return "hidden";
    }

    return leftState === "visible" && rightState === "visible"
      ? "visible"
      : "unknown";
  }),
});

const getResponsiveVisibilityFromClassNames = (
  classNames: string[] | null
): ResponsiveVisibility =>
  mergeAlternativeVisibility(classNames ? [classNames] : null);

const getResponsiveVisibility = (
  node: JsxOpeningLikeElement,
  ancestors: Node[] = []
): ResponsiveVisibility => {
  let visibility = mergeAlternativeVisibility(
    getClassAlternativesFromNode(node)
  );

  for (const ancestor of ancestors) {
    if (!isJsxElement(ancestor)) {
      continue;
    }

    visibility = intersectVisibility(
      visibility,
      mergeAlternativeVisibility(
        getClassAlternativesFromNode(ancestor.openingElement)
      )
    );
  }

  return visibility;
};

const responsiveVisibilitiesOverlap = (
  left: ResponsiveVisibility,
  right: ResponsiveVisibility
): VisibilityOverlap => {
  let hasUnknownOverlap = false;

  for (const [index, leftState] of left.bands.entries()) {
    const rightState = right.bands[index] ?? "unknown";

    if (leftState === "visible" && rightState === "visible") {
      return true;
    }

    if (leftState !== "hidden" && rightState !== "hidden") {
      hasUnknownOverlap = true;
    }
  }

  return hasUnknownOverlap ? null : false;
};

const isSmallScreenVisibility = (visibility: ResponsiveVisibility): boolean => {
  const firstBand = visibility.bands[0] ?? "unknown";
  const lastBand = visibility.bands.at(-1) ?? "unknown";

  return firstBand !== "hidden" && lastBand === "hidden";
};

export type { ResponsiveVisibility, VisibilityOverlap, VisibilityState };
export {
  getResponsiveVisibility,
  getResponsiveVisibilityFromClassNames,
  isSmallScreenVisibility,
  responsiveVisibilitiesOverlap,
};
