import path from "node:path";
import {
  type ArrowFunction,
  type BinaryExpression,
  type Expression,
  type FunctionExpression,
  forEachChild,
  isArrayLiteralExpression,
  isArrowFunction,
  isAsExpression,
  isBinaryExpression,
  isBlock,
  isConditionalExpression,
  isFunctionExpression,
  isFunctionLike,
  isIdentifier,
  isImportDeclaration,
  isJsxAttribute,
  isJsxElement,
  isJsxExpression,
  isJsxFragment,
  isJsxSelfClosingElement,
  isNamedImports,
  isNamespaceImport,
  isNonNullExpression,
  isParenthesizedExpression,
  isPrefixUnaryExpression,
  isPropertyAccessExpression,
  isReturnStatement,
  isSatisfiesExpression,
  isStringLiteral,
  isTypeAssertionExpression,
  type JsxChild,
  type JsxElement,
  type JsxFragment,
  type JsxOpeningLikeElement,
  type JsxSelfClosingElement,
  type Node,
  SyntaxKind,
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
import type { AuditRule, AuditRuleResult } from "../audit";
import {
  buildComponentRenderGraph,
  type ComponentRenderGraph,
  guardsCanCoexist,
  type RenderedJsxInstance,
  type RenderGuard,
} from "../component-render-graph";
import { advisory, fail, notApplicable, pass } from "./rule-result";

const BUTTON_GROUP_MODULE = "button-group";
const FORM_MODULE = "form";
const JOINED_CHILD_PATTERN =
  /not\(:first-child\)|rounded-[lrtb]-none|border-[lrtb]-0/;
const BUTTON_GROUP_MARKER_PATTERN = /data-slot\s*=\s*["']button-group["']/;
const BUTTON_GROUP_FILE_PATTERN =
  /(?:^|[\\/])ui[\\/](?:components[\\/])?button-group(?:[\\/]index)?\.[cm]?[jt]sx$/;
const UI_MODULE_PATTERN = /(?:^|\/)ui\/(?:components\/)?[^/]+$/;

const TEXT_CONTROLS = [
  { component: "Input", moduleFile: "input" },
  { component: "Textarea", moduleFile: "textarea" },
] as const;

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

type ButtonGroupContract = "joined" | "separate" | "unknown";
type ImportKind = "binding" | "namespace";
type SlotCertainty = "known" | "unknown";

interface SourceImportBinding {
  importedName: string | null;
  kind: ImportKind;
  moduleName: string;
}

interface TextControlHit {
  certainty: SlotCertainty;
  label: string;
  line: number;
}

interface ResolvedControl {
  component: string;
  imports: UiModuleImports;
}

interface FileContext {
  controls: ResolvedControl[];
  file: ParsedSourceFile;
  formImports: UiModuleImports;
  groupImports: UiModuleImports;
  imports: Map<string, SourceImportBinding>;
  uiAlias: string | undefined;
}

interface JoinedSlot {
  certainty: SlotCertainty;
  control: TextControlHit | null;
  guards: RenderGuard[];
}

interface CompositionEvidence {
  certainty: SlotCertainty;
  control: TextControlHit;
}

interface MountedGroupEvaluation {
  groupCount: number;
  result: AuditRuleResult | null;
}

interface ButtonGroupCandidate {
  contract: ButtonGroupContract;
  group: JsxElement;
}

const getOpeningElement = (node: Node): JsxOpeningLikeElement | null => {
  if (isJsxSelfClosingElement(node)) {
    return node;
  }

  return isJsxElement(node) ? node.openingElement : null;
};

const collectSourceImports = (
  file: ParsedSourceFile
): Map<string, SourceImportBinding> => {
  const imports = new Map<string, SourceImportBinding>();

  for (const statement of file.sourceFile.statements) {
    if (
      !(
        isImportDeclaration(statement) &&
        isStringLiteral(statement.moduleSpecifier)
      )
    ) {
      continue;
    }

    const importClause = statement.importClause;
    if (!importClause) {
      continue;
    }

    if (importClause.name) {
      imports.set(importClause.name.text, {
        importedName: "default",
        kind: "binding",
        moduleName: statement.moduleSpecifier.text,
      });
    }

    const bindings = importClause.namedBindings;
    if (bindings && isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        imports.set(element.name.text, {
          importedName: element.propertyName?.text ?? element.name.text,
          kind: "binding",
          moduleName: statement.moduleSpecifier.text,
        });
      }
    } else if (bindings && isNamespaceImport(bindings)) {
      imports.set(bindings.name.text, {
        importedName: null,
        kind: "namespace",
        moduleName: statement.moduleSpecifier.text,
      });
    }
  }

  return imports;
};

const createFileContext = (
  file: ParsedSourceFile,
  uiAlias: string | undefined
): FileContext => ({
  controls: TEXT_CONTROLS.map(({ component, moduleFile }) => ({
    component,
    imports: collectUiModuleImports(file.sourceFile, uiAlias, moduleFile),
  })),
  file,
  formImports: collectUiModuleImports(file.sourceFile, uiAlias, FORM_MODULE),
  groupImports: collectUiModuleImports(
    file.sourceFile,
    uiAlias,
    BUTTON_GROUP_MODULE
  ),
  imports: collectSourceImports(file),
  uiAlias,
});

const getImportBinding = (
  tagName: string,
  imports: Map<string, SourceImportBinding>
): SourceImportBinding | null => {
  const [rootName] = tagName.split(".");
  return rootName ? (imports.get(rootName) ?? null) : null;
};

const isUiModule = (
  moduleName: string,
  uiAlias: string | undefined
): boolean => {
  if (UI_MODULE_PATTERN.test(moduleName)) {
    return true;
  }

  if (!uiAlias) {
    return false;
  }

  const normalizedAlias = uiAlias.endsWith("/")
    ? uiAlias.slice(0, -1)
    : uiAlias;
  return moduleName.startsWith(`${normalizedAlias}/`);
};

const isKnownElement = (tagName: string, context: FileContext): boolean => {
  if (tagName[0] === tagName[0]?.toLowerCase()) {
    return true;
  }

  const binding = getImportBinding(tagName, context.imports);
  return Boolean(binding && isUiModule(binding.moduleName, context.uiAlias));
};

const isRadixSlot = (tagName: string, context: FileContext): boolean => {
  const binding = getImportBinding(tagName, context.imports);
  if (!(binding && binding.moduleName === "@radix-ui/react-slot")) {
    return false;
  }

  if (binding.kind === "binding") {
    return binding.importedName === "Slot" || binding.importedName === "Root";
  }

  const memberName = tagName.split(".")[1];
  return memberName === "Slot" || memberName === "Root";
};

const isTransparentElement = (tagName: string, context: FileContext): boolean =>
  tagName === "Fragment" ||
  tagName === "React.Fragment" ||
  resolveUiTagName(tagName, context.formImports) === "FormControl" ||
  isRadixSlot(tagName, context);

const getInputControlCertainty = (
  element: JsxOpeningLikeElement
): SlotCertainty | null => {
  const type = getJsxAttributeValue(element, "type");

  if (type.kind === "absent") {
    return "known";
  }

  if (type.kind === "dynamic") {
    return "unknown";
  }

  return typeof type.value === "string" &&
    NON_TEXT_INPUT_TYPES.has(type.value.toLowerCase())
    ? null
    : "known";
};

const getTextControl = (
  element: JsxOpeningLikeElement,
  context: FileContext
): TextControlHit | null => {
  const tagName = getJsxTagName(element);
  if (!tagName) {
    return null;
  }

  if (tagName === "textarea") {
    return {
      certainty: "known",
      label: "<textarea>",
      line: getLineNumber(context.file, element),
    };
  }

  if (tagName === "input") {
    const certainty = getInputControlCertainty(element);
    return certainty
      ? {
          certainty,
          label: "<input>",
          line: getLineNumber(context.file, element),
        }
      : null;
  }

  for (const { component, imports } of context.controls) {
    if (resolveUiTagName(tagName, imports) !== component) {
      continue;
    }

    const certainty =
      component === "Textarea" ? "known" : getInputControlCertainty(element);
    return certainty
      ? {
          certainty,
          label: `<${tagName}>`,
          line: getLineNumber(context.file, element),
        }
      : null;
  }

  return null;
};

const findNestedTextControl = (
  root: Node,
  context: FileContext
): TextControlHit | null => {
  let hit: TextControlHit | null = null;

  const visit = (node: Node): void => {
    if (hit) {
      return;
    }

    const element = getOpeningElement(node);
    if (element) {
      hit = getTextControl(element, context);
    }

    if (!hit) {
      forEachChild(node, visit);
    }
  };

  forEachChild(root, visit);
  return hit;
};

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

const isSimpleGuardExpression = (expression: Expression): boolean =>
  isIdentifier(expression) ||
  (isPropertyAccessExpression(expression) &&
    isSimpleGuardExpression(expression.expression));

const createGuard = (
  condition: Expression,
  branch: RenderGuard["branch"],
  context: FileContext
): RenderGuard => {
  const simple = getSimpleGuardExpression(condition);
  const resolvedBranch = simple.inverted ? invertBranch(branch) : branch;
  const id = isSimpleGuardExpression(simple.expression)
    ? JSON.stringify([
        path.resolve(context.file.filePath),
        "button-group-guard",
        simple.expression.getText(context.file.sourceFile),
      ])
    : JSON.stringify([
        path.resolve(context.file.filePath),
        condition.getStart(context.file.sourceFile),
      ]);

  return { branch: resolvedBranch, id };
};

const appendGuard = (
  guards: RenderGuard[],
  condition: Expression,
  branch: RenderGuard["branch"],
  context: FileContext
): RenderGuard[] => [...guards, createGuard(condition, branch, context)];

const unwrapExpression = (expression: Expression): Expression => {
  let current = expression;

  while (
    isParenthesizedExpression(current) ||
    isAsExpression(current) ||
    isTypeAssertionExpression(current) ||
    isNonNullExpression(current) ||
    isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }

  return current;
};

const getBinaryBranch = (
  node: BinaryExpression
): RenderGuard["branch"] | null => {
  if (node.operatorToken.kind === SyntaxKind.AmpersandAmpersandToken) {
    return "truthy";
  }

  return node.operatorToken.kind === SyntaxKind.BarBarToken ? "falsy" : null;
};

const collectExpressionSlots = (
  rawExpression: Expression,
  guards: RenderGuard[],
  context: FileContext
): JoinedSlot[] => {
  const expression = unwrapExpression(rawExpression);

  if (
    isJsxElement(expression) ||
    isJsxSelfClosingElement(expression) ||
    isJsxFragment(expression)
  ) {
    return collectJsxSlots(expression, guards, context);
  }

  if (isConditionalExpression(expression)) {
    return [
      ...collectExpressionSlots(
        expression.whenTrue,
        appendGuard(guards, expression.condition, "truthy", context),
        context
      ),
      ...collectExpressionSlots(
        expression.whenFalse,
        appendGuard(guards, expression.condition, "falsy", context),
        context
      ),
    ];
  }

  if (isBinaryExpression(expression)) {
    if (expression.operatorToken.kind === SyntaxKind.CommaToken) {
      return collectExpressionSlots(expression.right, guards, context);
    }

    const branch = getBinaryBranch(expression);
    if (branch === "truthy") {
      return collectExpressionSlots(
        expression.right,
        appendGuard(guards, expression.left, branch, context),
        context
      );
    }

    if (
      branch === "falsy" ||
      expression.operatorToken.kind === SyntaxKind.QuestionQuestionToken
    ) {
      return [
        ...collectExpressionSlots(
          expression.left,
          appendGuard(guards, expression.left, "truthy", context),
          context
        ),
        ...collectExpressionSlots(
          expression.right,
          appendGuard(guards, expression.left, "falsy", context),
          context
        ),
      ];
    }
  }

  if (isArrayLiteralExpression(expression)) {
    return expression.elements.flatMap((element) =>
      collectExpressionSlots(element, guards, context)
    );
  }

  if (
    expression.kind === SyntaxKind.NullKeyword ||
    expression.kind === SyntaxKind.TrueKeyword ||
    expression.kind === SyntaxKind.FalseKeyword ||
    expression.kind === SyntaxKind.StringLiteral ||
    expression.kind === SyntaxKind.NumericLiteral
  ) {
    return [];
  }

  return [{ certainty: "unknown", control: null, guards }];
};

const collectElementSlots = (
  node: JsxElement | JsxSelfClosingElement,
  guards: RenderGuard[],
  context: FileContext
): JoinedSlot[] => {
  const element = getOpeningElement(node);
  const tagName = element ? getJsxTagName(element) : null;
  if (!(element && tagName)) {
    return [];
  }

  const control = getTextControl(element, context);
  if (control) {
    return [{ certainty: "known", control, guards }];
  }

  if (isJsxElement(node) && isTransparentElement(tagName, context)) {
    return node.children.flatMap((child) =>
      collectChildSlots(child, guards, context)
    );
  }

  if (isKnownElement(tagName, context)) {
    return [{ certainty: "known", control: null, guards }];
  }

  const nestedControl = findNestedTextControl(node, context);
  return [
    {
      certainty: "unknown",
      control: nestedControl
        ? { ...nestedControl, certainty: "unknown" }
        : null,
      guards,
    },
  ];
};

const collectJsxSlots = (
  node: JsxElement | JsxSelfClosingElement | JsxFragment,
  guards: RenderGuard[],
  context: FileContext
): JoinedSlot[] => {
  if (isJsxFragment(node)) {
    return node.children.flatMap((child) =>
      collectChildSlots(child, guards, context)
    );
  }

  return collectElementSlots(node, guards, context);
};

const collectChildSlots = (
  child: JsxChild,
  guards: RenderGuard[],
  context: FileContext
): JoinedSlot[] => {
  if (
    isJsxElement(child) ||
    isJsxSelfClosingElement(child) ||
    isJsxFragment(child)
  ) {
    return collectJsxSlots(child, guards, context);
  }

  if (isJsxExpression(child) && child.expression) {
    return collectExpressionSlots(child.expression, guards, context);
  }

  return [];
};

const getCompositionEvidence = (
  group: JsxElement,
  context: FileContext
): CompositionEvidence | null => {
  const slots = group.children.flatMap((child) =>
    collectChildSlots(child, [], context)
  );
  let uncertain: CompositionEvidence | null = null;

  for (const [index, slot] of slots.entries()) {
    if (!slot.control) {
      continue;
    }

    for (const sibling of slots
      .slice(0, index)
      .concat(slots.slice(index + 1))) {
      if (!guardsCanCoexist(slot.guards, sibling.guards)) {
        continue;
      }

      const certainty =
        slot.certainty === "known" &&
        slot.control.certainty === "known" &&
        sibling.certainty === "known"
          ? "known"
          : "unknown";
      const evidence: CompositionEvidence = {
        certainty,
        control: slot.control,
      };
      if (certainty === "known") {
        return evidence;
      }

      uncertain ??= evidence;
    }
  }

  return uncertain;
};

type RenderPropFunction = ArrowFunction | FunctionExpression;

const getRenderPropFunction = (
  node: JsxOpeningLikeElement
): RenderPropFunction | null => {
  for (const property of node.attributes.properties) {
    if (
      !(
        isJsxAttribute(property) &&
        property.name.getText() === "render" &&
        property.initializer &&
        isJsxExpression(property.initializer) &&
        property.initializer.expression
      )
    ) {
      continue;
    }

    const expression = property.initializer.expression;
    if (isArrowFunction(expression) || isFunctionExpression(expression)) {
      return expression;
    }
  }

  return null;
};

const getReturnedExpressions = (
  renderFunction: RenderPropFunction
): Expression[] => {
  if (isArrowFunction(renderFunction) && !isBlock(renderFunction.body)) {
    return [renderFunction.body];
  }

  const expressions: Expression[] = [];
  const visit = (node: Node): void => {
    if (node !== renderFunction && isFunctionLike(node)) {
      return;
    }

    if (isReturnStatement(node)) {
      if (node.expression) {
        expressions.push(node.expression);
      }
      return;
    }

    forEachChild(node, visit);
  };

  visit(renderFunction.body);
  return expressions;
};

type RenderedJsxNode = JsxElement | JsxSelfClosingElement | JsxFragment;
type RenderedJsxVisitor = (node: RenderedJsxNode) => void;

const visitRenderedExpression = (
  rawExpression: Expression,
  visitor: RenderedJsxVisitor
): void => {
  const expression = unwrapExpression(rawExpression);
  if (
    isJsxElement(expression) ||
    isJsxSelfClosingElement(expression) ||
    isJsxFragment(expression)
  ) {
    visitRenderedJsx(expression, visitor);
    return;
  }

  if (isConditionalExpression(expression)) {
    visitRenderedExpression(expression.whenTrue, visitor);
    visitRenderedExpression(expression.whenFalse, visitor);
    return;
  }

  if (isBinaryExpression(expression)) {
    visitRenderedExpression(expression.left, visitor);
    visitRenderedExpression(expression.right, visitor);
    return;
  }

  if (isArrayLiteralExpression(expression)) {
    for (const element of expression.elements) {
      visitRenderedExpression(element, visitor);
    }
  }
};

const visitRenderedChild = (
  child: JsxChild,
  visitor: RenderedJsxVisitor
): void => {
  if (
    isJsxElement(child) ||
    isJsxSelfClosingElement(child) ||
    isJsxFragment(child)
  ) {
    visitRenderedJsx(child, visitor);
  } else if (isJsxExpression(child) && child.expression) {
    visitRenderedExpression(child.expression, visitor);
  }
};

const visitRenderedJsx = (
  node: RenderedJsxNode,
  visitor: RenderedJsxVisitor
): void => {
  visitor(node);
  if (isJsxElement(node) || isJsxFragment(node)) {
    for (const child of node.children) {
      visitRenderedChild(child, visitor);
    }
  }
};

const findRenderedButtonGroups = (
  renderFunction: RenderPropFunction,
  context: FileContext
): JsxElement[] => {
  const groups: JsxElement[] = [];
  const collectGroup: RenderedJsxVisitor = (node) => {
    if (isJsxElement(node)) {
      const tagName = getJsxTagName(node.openingElement);
      if (
        tagName &&
        resolveUiTagName(tagName, context.groupImports) === "ButtonGroup"
      ) {
        groups.push(node);
      }
    }
  };

  for (const expression of getReturnedExpressions(renderFunction)) {
    visitRenderedExpression(expression, collectGroup);
  }
  return groups;
};

const findFormFieldRenderButtonGroups = (
  form: JsxElement,
  context: FileContext
): JsxElement[] => {
  const groups: JsxElement[] = [];

  visitRenderedJsx(form, (node) => {
    const element = getOpeningElement(node);
    const tagName = element ? getJsxTagName(element) : null;
    if (
      !(
        element &&
        tagName &&
        resolveUiTagName(tagName, context.formImports) === "FormField"
      )
    ) {
      return;
    }

    const renderFunction = getRenderPropFunction(element);
    if (renderFunction) {
      groups.push(...findRenderedButtonGroups(renderFunction, context));
    }
  });

  return groups;
};

const isButtonGroupInstance = (
  instance: RenderedJsxInstance,
  context: FileContext
): boolean =>
  resolveUiTagName(instance.tagName, context.groupImports) === "ButtonGroup";

const isFormFieldInstance = (
  instance: RenderedJsxInstance,
  context: FileContext
): boolean =>
  resolveUiTagName(instance.tagName, context.formImports) === "FormField";

const isFormProviderInstance = (
  instance: RenderedJsxInstance,
  context: FileContext
): boolean =>
  resolveUiTagName(instance.tagName, context.formImports) === "Form";

const getInstanceElement = (
  instance: RenderedJsxInstance
): JsxElement | null => {
  const parent = instance.node.parent;
  return isJsxElement(parent) && parent.openingElement === instance.node
    ? parent
    : null;
};

const getContractFromSource = (source: string): ButtonGroupContract => {
  const hasButtonGroupMarker = BUTTON_GROUP_MARKER_PATTERN.test(source);
  if (hasButtonGroupMarker && JOINED_CHILD_PATTERN.test(source)) {
    return "joined";
  }

  return hasButtonGroupMarker ? "separate" : "unknown";
};

const getProjectButtonGroupContract = (
  files: ParsedSourceFile[]
): ButtonGroupContract => {
  const sourceFile = files.find((file) =>
    BUTTON_GROUP_FILE_PATTERN.test(path.resolve(file.filePath))
  );
  return sourceFile
    ? getContractFromSource(sourceFile.sourceFile.text)
    : "unknown";
};

const getButtonGroupContract = (
  instance: RenderedJsxInstance,
  filesByPath: Map<string, ParsedSourceFile>,
  projectContract: ButtonGroupContract
): ButtonGroupContract => {
  const targetPath = instance.resolvedTargetFilePath;
  if (!targetPath) {
    return projectContract;
  }

  const source = filesByPath.get(path.resolve(targetPath))?.sourceFile.text;
  if (!source) {
    return projectContract;
  }

  return getContractFromSource(source);
};

const getButtonGroupCandidates = (
  instance: RenderedJsxInstance,
  context: FileContext,
  filesByPath: Map<string, ParsedSourceFile>,
  projectContract: ButtonGroupContract
): ButtonGroupCandidate[] => {
  if (isButtonGroupInstance(instance, context)) {
    const group = getInstanceElement(instance);
    return group
      ? [
          {
            contract: getButtonGroupContract(
              instance,
              filesByPath,
              projectContract
            ),
            group,
          },
        ]
      : [];
  }

  if (!isFormFieldInstance(instance, context)) {
    const form = isFormProviderInstance(instance, context)
      ? getInstanceElement(instance)
      : null;
    return form
      ? findFormFieldRenderButtonGroups(form, context).map((group) => ({
          contract: projectContract,
          group,
        }))
      : [];
  }

  const renderFunction = getRenderPropFunction(instance.node);
  return renderFunction
    ? findRenderedButtonGroups(renderFunction, context).map((group) => ({
        contract: projectContract,
        group,
      }))
    : [];
};

const createCompositionResult = (
  evidence: CompositionEvidence,
  contract: ButtonGroupContract,
  filePath: string
): AuditRuleResult | null => {
  if (contract === "separate") {
    return null;
  }

  const remediation =
    "Use InputGroup with InputGroupInput and InputGroupAddon so the combined control owns one consistent focus treatment. Keep ButtonGroup for controls that retain independent focus treatment.";

  if (evidence.certainty === "known" && contract === "joined") {
    return fail(
      `ButtonGroup joins ${evidence.control.label} with another rendered control, so separate focus treatment splits what looks like one control.`,
      remediation,
      { filePath, line: evidence.control.line }
    );
  }

  const uncertainty =
    contract === "unknown"
      ? "the ButtonGroup joined-child styling could not be confirmed"
      : "the rendered child composition could not be proven";
  return advisory(
    `ButtonGroup may join ${evidence.control.label} with another control, but ${uncertainty}.`,
    remediation,
    filePath,
    evidence.control.line
  );
};

const countSourceButtonGroups = (
  files: ParsedSourceFile[],
  uiAlias: string | undefined
): number => {
  let count = 0;

  for (const file of files) {
    const imports = collectUiModuleImports(
      file.sourceFile,
      uiAlias,
      BUTTON_GROUP_MODULE
    );
    if (imports.locals.size === 0 && imports.namespaces.size === 0) {
      continue;
    }

    const visit = (node: Node): void => {
      const element = getOpeningElement(node);
      const tagName = element ? getJsxTagName(element) : null;
      if (tagName && resolveUiTagName(tagName, imports) === "ButtonGroup") {
        count += 1;
      }
      forEachChild(node, visit);
    };
    forEachChild(file.sourceFile, visit);
  }

  return count;
};

const evaluateMountedButtonGroups = (
  graph: ComponentRenderGraph,
  filesByPath: Map<string, ParsedSourceFile>,
  projectContract: ButtonGroupContract,
  uiAlias: string | undefined
): MountedGroupEvaluation => {
  const contexts = new Map<string, FileContext>();
  const seenCallsites = new Set<string>();
  let groupCount = 0;
  let firstAdvisory: AuditRuleResult | null = null;

  const getContext = (file: ParsedSourceFile): FileContext => {
    const key = path.resolve(file.filePath);
    const existing = contexts.get(key);
    if (existing) {
      return existing;
    }

    const context = createFileContext(file, uiAlias);
    contexts.set(key, context);
    return context;
  };

  for (const surface of graph.surfaces) {
    for (const instance of surface.instances) {
      const context = getContext(instance.file);
      const candidates = getButtonGroupCandidates(
        instance,
        context,
        filesByPath,
        projectContract
      );

      for (const candidate of candidates) {
        const callsiteKey = JSON.stringify([
          path.resolve(instance.file.filePath),
          candidate.group.getStart(instance.file.sourceFile),
        ]);
        if (seenCallsites.has(callsiteKey)) {
          continue;
        }
        seenCallsites.add(callsiteKey);
        groupCount += 1;

        const evidence = getCompositionEvidence(candidate.group, context);
        if (!evidence) {
          continue;
        }

        const result = createCompositionResult(
          evidence,
          candidate.contract,
          instance.file.filePath
        );
        if (result?.status === "fail") {
          return { groupCount, result };
        }
        firstAdvisory ??= result;
      }
    }
  }

  return { groupCount, result: firstAdvisory };
};

const buttonGroupHoldsOnlyButtonsRule: AuditRule = {
  adapters: ["core"],
  category: "forms",
  confidence: "medium",
  description:
    "Checks rendered ButtonGroup compositions for text controls whose per-control focus treatment splits the joined surface.",
  id: "button-group-holds-only-buttons",
  maxScore: 2,
  run: async ({ filesystemRoot, project }) => {
    if (!project.shadcn.configPath) {
      return notApplicable("No valid shadcn configuration was found.");
    }

    const files = await parseProjectSourceFiles(project);
    const filesByPath = new Map(
      files.map((file) => [path.resolve(file.filePath), file])
    );
    const graph = await buildComponentRenderGraph(project, filesystemRoot);
    const uiAlias = project.shadcn.aliases.ui;
    const evaluation = evaluateMountedButtonGroups(
      graph,
      filesByPath,
      getProjectButtonGroupContract(files),
      uiAlias
    );

    if (evaluation.result) {
      return evaluation.result;
    }

    if (evaluation.groupCount === 0) {
      const sourceGroupCount = countSourceButtonGroups(files, uiAlias);
      if (graph.surfaces.length === 0 && sourceGroupCount > 0) {
        return advisory(
          "ButtonGroup source was found, but no mounted render surface could be established.",
          "Verify whether the ButtonGroup is rendered. If it joins a text control and button, use InputGroup instead."
        );
      }

      return notApplicable("No rendered ButtonGroup compositions were found.");
    }

    return pass(
      `All ${evaluation.groupCount} rendered ButtonGroup compositions avoid joining text controls with sibling controls.`
    );
  },
  severity: "warning",
  title: "ButtonGroup holds buttons, not text inputs",
};

export { buttonGroupHoldsOnlyButtonsRule };
