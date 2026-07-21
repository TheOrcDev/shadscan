import {
  type Block,
  type Expression,
  type IfStatement,
  isBlock,
  isDoStatement,
  isForInStatement,
  isForOfStatement,
  isForStatement,
  isIfStatement,
  isReturnStatement,
  isSwitchStatement,
  isThrowStatement,
  isTryStatement,
  isWhileStatement,
  type Node,
  type Statement,
} from "typescript";
import { getGuard } from "./source-index";
import type {
  ComponentNodeRecord,
  GraphBuildState,
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

const appendGuard = (
  context: TemplateContext,
  owner: ComponentNodeRecord,
  condition: Node,
  branch: "falsy" | "truthy"
): TemplateContext => ({
  ...context,
  guards: [...context.guards, getGuard(owner.file, condition, branch)],
});

const createUnsupportedFlow = (
  owner: ComponentNodeRecord,
  node: Node,
  context: TemplateContext,
  state: GraphBuildState,
  isNavigationRelevant: IsNavigationRelevant
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
  relevant: isNavigationRelevant(owner, node, state),
});

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

  if (
    isSwitchStatement(statement) ||
    isTryStatement(statement) ||
    isDoStatement(statement) ||
    isForInStatement(statement) ||
    isForOfStatement(statement) ||
    isForStatement(statement) ||
    isWhileStatement(statement)
  ) {
    return {
      continuations: [context],
      items: [
        createUnsupportedFlow(
          owner,
          statement,
          context,
          state,
          isNavigationRelevant
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

  for (const statement of statements) {
    if (contexts.length === 0 || state.edgeTraversalHalted) {
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

export { collectRenderedReturnItems };
