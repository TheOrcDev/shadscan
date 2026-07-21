import path from "node:path";
import {
  type Block,
  type Expression,
  type IfStatement,
  isBlock,
  isDoStatement,
  isForInStatement,
  isForOfStatement,
  isForStatement,
  isIdentifier,
  isIfStatement,
  isParenthesizedExpression,
  isPrefixUnaryExpression,
  isPropertyAccessExpression,
  isReturnStatement,
  isSwitchStatement,
  isThrowStatement,
  isTryStatement,
  isWhileStatement,
  type Node,
  type Statement,
  SyntaxKind,
} from "typescript";
import { walkNodes } from "../ast";
import { compareCodeUnits } from "../deterministic-order";
import type {
  ComponentNodeRecord,
  GraphBuildState,
  RenderGuard,
  RenderOpaqueTemplate,
  RenderTemplateItem,
  TemplateContext,
} from "./types";

type CollectExpression = (
  owner: ComponentNodeRecord,
  expression: Expression,
  context: TemplateContext,
  state: GraphBuildState
) => RenderTemplateItem[];

type IsNavigationRelevant = (
  owner: ComponentNodeRecord,
  node: Node,
  state: GraphBuildState
) => boolean;

interface FlowResult {
  continuations: TemplateContext[];
  items: RenderTemplateItem[];
}

const invertBranch = (branch: RenderGuard["branch"]): RenderGuard["branch"] =>
  branch === "truthy" ? "falsy" : "truthy";

const getSimpleGuardExpression = (
  condition: Expression
): { expression: Expression; inverted: boolean } => {
  let expression = condition;
  let inverted = false;

  while (isParenthesizedExpression(expression)) {
    expression = expression.expression;
  }

  while (
    isPrefixUnaryExpression(expression) &&
    expression.operator === SyntaxKind.ExclamationToken
  ) {
    inverted = !inverted;
    expression = expression.operand;
    while (isParenthesizedExpression(expression)) {
      expression = expression.expression;
    }
  }

  return { expression, inverted };
};

const isSimpleGuardExpression = (expression: Expression): boolean => {
  if (isIdentifier(expression)) {
    return true;
  }

  return (
    isPropertyAccessExpression(expression) &&
    isSimpleGuardExpression(expression.expression)
  );
};

const getGuardReferencedNames = (condition: Expression): string[] => {
  const names = new Set<string>();
  walkNodes(condition, (candidate) => {
    if (isIdentifier(candidate)) {
      names.add(candidate.text);
    }
  });
  return [...names].sort(compareCodeUnits);
};

const getRenderGuard = (
  owner: ComponentNodeRecord,
  condition: Expression,
  branch: RenderGuard["branch"]
): RenderGuard => {
  const simple = getSimpleGuardExpression(condition);
  const resolvedBranch = simple.inverted ? invertBranch(branch) : branch;
  const id = isSimpleGuardExpression(simple.expression)
    ? JSON.stringify([
        owner.id,
        "guard",
        simple.expression.getText(owner.file.sourceFile),
      ])
    : JSON.stringify([
        path.resolve(owner.file.filePath),
        condition.getStart(owner.file.sourceFile),
      ]);

  return {
    branch: resolvedBranch,
    id,
    referencedNames: getGuardReferencedNames(condition),
  };
};

const appendGuard = (
  context: TemplateContext,
  owner: ComponentNodeRecord,
  condition: Expression,
  branch: "falsy" | "truthy"
): TemplateContext => ({
  ...context,
  guards: [...context.guards, getRenderGuard(owner, condition, branch)],
});

const createUnsupportedFlow = (
  owner: ComponentNodeRecord,
  node: Node,
  context: TemplateContext,
  relevant: boolean
): RenderOpaqueTemplate => ({
  guards: context.guards,
  id: JSON.stringify([
    owner.id,
    "opaque-flow",
    node.getStart(owner.file.sourceFile),
  ]),
  kind: "opaque",
  reason:
    "Navigation in unsupported control flow could not be proven concurrent.",
  relevant,
});

const isUnsupportedControlFlow = (statement: Statement): boolean =>
  isSwitchStatement(statement) ||
  isTryStatement(statement) ||
  isDoStatement(statement) ||
  isForInStatement(statement) ||
  isForOfStatement(statement) ||
  isForStatement(statement) ||
  isWhileStatement(statement);

const processBlock = (
  owner: ComponentNodeRecord,
  block: Block,
  contexts: TemplateContext[],
  state: GraphBuildState,
  collectExpression: CollectExpression,
  isNavigationRelevant: IsNavigationRelevant
): FlowResult =>
  processStatements(
    owner,
    block.statements,
    contexts,
    state,
    collectExpression,
    isNavigationRelevant
  );

const processBranch = (
  owner: ComponentNodeRecord,
  statement: Statement,
  context: TemplateContext,
  state: GraphBuildState,
  collectExpression: CollectExpression,
  isNavigationRelevant: IsNavigationRelevant
): FlowResult => {
  if (isBlock(statement)) {
    return processBlock(
      owner,
      statement,
      [context],
      state,
      collectExpression,
      isNavigationRelevant
    );
  }

  return processStatement(
    owner,
    statement,
    context,
    state,
    collectExpression,
    isNavigationRelevant
  );
};

const processIf = (
  owner: ComponentNodeRecord,
  statement: IfStatement,
  context: TemplateContext,
  state: GraphBuildState,
  collectExpression: CollectExpression,
  isNavigationRelevant: IsNavigationRelevant
): FlowResult => {
  const truthyContext = appendGuard(
    context,
    owner,
    statement.expression,
    "truthy"
  );
  const falsyContext = appendGuard(
    context,
    owner,
    statement.expression,
    "falsy"
  );
  const truthy = processBranch(
    owner,
    statement.thenStatement,
    truthyContext,
    state,
    collectExpression,
    isNavigationRelevant
  );
  const falsy = statement.elseStatement
    ? processBranch(
        owner,
        statement.elseStatement,
        falsyContext,
        state,
        collectExpression,
        isNavigationRelevant
      )
    : { continuations: [falsyContext], items: [] };
  const bothBranchesContinue =
    truthy.continuations.length > 0 && falsy.continuations.length > 0;
  const branchesConvergeWithoutRenderedReturns =
    bothBranchesContinue &&
    truthy.items.length === 0 &&
    falsy.items.length === 0;

  return {
    continuations: branchesConvergeWithoutRenderedReturns
      ? [context]
      : [...truthy.continuations, ...falsy.continuations],
    items: [...truthy.items, ...falsy.items],
  };
};

const processStatement = (
  owner: ComponentNodeRecord,
  statement: Statement,
  context: TemplateContext,
  state: GraphBuildState,
  collectExpression: CollectExpression,
  isNavigationRelevant: IsNavigationRelevant
): FlowResult => {
  if (isReturnStatement(statement)) {
    return {
      continuations: [],
      items: statement.expression
        ? collectExpression(owner, statement.expression, context, state)
        : [],
    };
  }

  if (isThrowStatement(statement)) {
    return { continuations: [], items: [] };
  }

  if (isIfStatement(statement)) {
    return processIf(
      owner,
      statement,
      context,
      state,
      collectExpression,
      isNavigationRelevant
    );
  }

  if (isBlock(statement)) {
    return processBlock(
      owner,
      statement,
      [context],
      state,
      collectExpression,
      isNavigationRelevant
    );
  }

  if (isUnsupportedControlFlow(statement)) {
    return {
      continuations: [],
      items: [
        createUnsupportedFlow(
          owner,
          statement,
          context,
          isNavigationRelevant(owner, statement, state)
        ),
      ],
    };
  }

  return { continuations: [context], items: [] };
};

function processStatements(
  owner: ComponentNodeRecord,
  statements: readonly Statement[],
  initialContexts: TemplateContext[],
  state: GraphBuildState,
  collectExpression: CollectExpression,
  isNavigationRelevant: IsNavigationRelevant
): FlowResult {
  let contexts = initialContexts;
  const items: RenderTemplateItem[] = [];

  for (const [statementIndex, statement] of statements.entries()) {
    if (contexts.length === 0 || state.edgeTraversalHalted) {
      break;
    }

    if (isUnsupportedControlFlow(statement)) {
      const affectedNodes = statements.slice(statementIndex);
      const relevant = affectedNodes.some((candidate) =>
        isNavigationRelevant(owner, candidate, state)
      );

      for (const context of contexts) {
        items.push(createUnsupportedFlow(owner, statement, context, relevant));
      }
      contexts = [];
      break;
    }

    const nextContexts: TemplateContext[] = [];
    for (const context of contexts) {
      const result = processStatement(
        owner,
        statement,
        context,
        state,
        collectExpression,
        isNavigationRelevant
      );
      items.push(...result.items);
      nextContexts.push(...result.continuations);
    }
    contexts = nextContexts;
  }

  return { continuations: contexts, items };
}

const collectRenderedReturnItems = (
  owner: ComponentNodeRecord,
  state: GraphBuildState,
  context: TemplateContext,
  collectExpression: CollectExpression,
  isNavigationRelevant: IsNavigationRelevant
): RenderTemplateItem[] => {
  const body = owner.declaration.body;

  if (!body) {
    return [];
  }

  if (!isBlock(body)) {
    return collectExpression(owner, body, context, state);
  }

  return processBlock(
    owner,
    body,
    [context],
    state,
    collectExpression,
    isNavigationRelevant
  ).items;
};

export { collectRenderedReturnItems, getRenderGuard };
