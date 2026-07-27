import {
  type ArrayLiteralExpression,
  type CallExpression,
  type Expression,
  isArrayLiteralExpression,
  isArrowFunction,
  isCallExpression,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isImportDeclaration,
  isNamedImports,
  isNoSubstitutionTemplateLiteral,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isStringLiteral,
  isVariableDeclaration,
  type Node,
  type ObjectLiteralExpression,
  SyntaxKind,
} from "typescript";
import { type ParsedSourceFile, type SourceScope, walkNodes } from "../ast";

/**
 * Hotkey libraries whose registration is declarative enough to verify. Each
 * entry states how *that library* expresses "do not fire while typing" —
 * the two supported libraries express it with opposite polarity, so this
 * cannot collapse into one shared option name.
 */
type HotkeyLibrary = "react-hotkeys-hook" | "tanstack";

interface HotkeyModule {
  hookNames: readonly string[];
  library: HotkeyLibrary;
}

const HOTKEY_MODULES: Readonly<Record<string, HotkeyModule>> = {
  "@tanstack/react-hotkeys": {
    hookNames: ["useHotkey", "useHotkeys"],
    library: "tanstack",
  },
  "react-hotkeys-hook": {
    hookNames: ["useHotkeys"],
    library: "react-hotkeys-hook",
  },
};

/**
 * Modifiers TanStack treats as "shortcut-like", for which `ignoreInputs`
 * defaults to false. Documented as: true for single keys and Shift/Alt
 * combos; false for Ctrl/Meta shortcuts and Escape.
 */
const SHORTCUT_MODIFIERS = new Set([
  "cmd",
  "command",
  "control",
  "ctrl",
  "meta",
  "mod",
  "super",
  "win",
]);
const ESCAPE_KEYS = new Set(["esc", "escape"]);
const TARGET_KEY = "d";

interface DeclarativeHotkey {
  callback: Node;
  guardsTypingTargets: boolean;
  line: number;
  targetsDKey: boolean;
}

type StaticOption =
  | { kind: "absent" }
  | { kind: "boolean"; value: boolean }
  | { kind: "list"; empty: boolean }
  | { kind: "unknown" };

const getKeySegments = (spec: string): string[] =>
  spec
    .split("+")
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);

/**
 * Both libraries accept several specs at once — comma-separated for
 * `react-hotkeys-hook`, an array for either.
 */
const getStaticKeySpecs = (expression: Expression): string[] | null => {
  if (
    isStringLiteral(expression) ||
    isNoSubstitutionTemplateLiteral(expression)
  ) {
    return expression.text
      .split(",")
      .map((spec) => spec.trim())
      .filter(Boolean);
  }

  if (isArrayLiteralExpression(expression)) {
    const specs: string[] = [];

    for (const element of expression.elements) {
      const nested = getStaticKeySpecs(element);

      if (!nested) {
        return null;
      }

      specs.push(...nested);
    }

    return specs;
  }

  return null;
};

const specTargetsDKey = (spec: string): boolean =>
  getKeySegments(spec).at(-1) === TARGET_KEY;

/**
 * TanStack's documented conditional default for `ignoreInputs`. Only safe
 * when *every* spec defaults to guarded — one Ctrl/Meta spec is enough to
 * let the shortcut fire inside an input.
 */
const tanstackDefaultsToGuarded = (specs: string[]): boolean =>
  specs.every((spec) => {
    const segments = getKeySegments(spec);
    const baseKey = segments.at(-1) ?? "";

    if (ESCAPE_KEYS.has(baseKey)) {
      return false;
    }

    return !segments
      .slice(0, -1)
      .some((modifier) => SHORTCUT_MODIFIERS.has(modifier));
  });

const readStaticOption = (
  options: ObjectLiteralExpression,
  name: string
): StaticOption => {
  const assignments = options.properties.filter(
    (property) =>
      isPropertyAssignment(property) &&
      (isIdentifier(property.name) || isStringLiteral(property.name)) &&
      property.name.text === name
  );

  if (assignments.length === 0) {
    return { kind: "absent" };
  }

  const assignment = assignments[0];

  if (
    assignments.length > 1 ||
    !(assignment && isPropertyAssignment(assignment))
  ) {
    return { kind: "unknown" };
  }

  const initializer = assignment.initializer;

  if (initializer.kind === SyntaxKind.TrueKeyword) {
    return { kind: "boolean", value: true };
  }

  if (initializer.kind === SyntaxKind.FalseKeyword) {
    return { kind: "boolean", value: false };
  }

  if (isArrayLiteralExpression(initializer)) {
    return { empty: initializer.elements.length === 0, kind: "list" };
  }

  return { kind: "unknown" };
};

/**
 * `react-hotkeys-hook` guards form tags by default; the risk is the opt-out.
 * `@tanstack/react-hotkeys` uses `ignoreInputs`, whose default depends on
 * the key spec.
 */
const guardsTypingTargets = (
  library: HotkeyLibrary,
  options: ObjectLiteralExpression | null,
  specs: string[]
): boolean => {
  if (library === "react-hotkeys-hook") {
    if (!options) {
      return true;
    }

    const enableOnFormTags = readStaticOption(options, "enableOnFormTags");

    if (enableOnFormTags.kind === "absent") {
      return true;
    }

    if (enableOnFormTags.kind === "boolean") {
      return !enableOnFormTags.value;
    }

    return enableOnFormTags.kind === "list" && enableOnFormTags.empty;
  }

  if (!options) {
    return tanstackDefaultsToGuarded(specs);
  }

  const ignoreInputs = readStaticOption(options, "ignoreInputs");

  if (ignoreInputs.kind === "absent") {
    return tanstackDefaultsToGuarded(specs);
  }

  return ignoreInputs.kind === "boolean" && ignoreInputs.value;
};

const isFunctionNode = (node: Node): boolean =>
  isArrowFunction(node) || isFunctionExpression(node);

/**
 * The third argument of `react-hotkeys-hook`'s `useHotkeys` is
 * `OptionsOrDependencyArray`: an array there is a dependency list, not
 * options. Anything that is neither an object nor an array literal cannot
 * be read statically, and the caller must not assume it is benign.
 */
const readOptionsArgument = (
  argument: Expression | undefined
): { options: ObjectLiteralExpression | null } | null => {
  if (!argument) {
    return { options: null };
  }

  if (isObjectLiteralExpression(argument)) {
    return { options: argument };
  }

  if (isArrayLiteralExpression(argument)) {
    return { options: null };
  }

  return null;
};

const getHotkeyModuleForLocalName = (
  file: ParsedSourceFile,
  localName: string
): HotkeyModule | null => {
  const matches: HotkeyModule[] = [];

  for (const statement of file.sourceFile.statements) {
    if (
      !(
        isImportDeclaration(statement) &&
        isStringLiteral(statement.moduleSpecifier) &&
        statement.importClause?.namedBindings &&
        isNamedImports(statement.importClause.namedBindings)
      )
    ) {
      continue;
    }

    const hotkeyModule = HOTKEY_MODULES[statement.moduleSpecifier.text];

    if (!hotkeyModule) {
      continue;
    }

    for (const element of statement.importClause.namedBindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;

      if (
        element.name.text === localName &&
        hotkeyModule.hookNames.includes(importedName)
      ) {
        matches.push(hotkeyModule);
      }
    }
  }

  return matches.length === 1 ? matches[0] : null;
};

/** A local declaration of the same name shadows the import — do not trust it. */
const hasLocalDeclaration = (
  file: ParsedSourceFile,
  localName: string
): boolean => {
  let shadowed = false;

  walkNodes(file.sourceFile, (node) => {
    if (
      (isFunctionDeclaration(node) && node.name?.text === localName) ||
      (isVariableDeclaration(node) &&
        isIdentifier(node.name) &&
        node.name.text === localName)
    ) {
      shadowed = true;
      return false;
    }

    return true;
  });

  return shadowed;
};

const readTanstackDefinitions = (
  definitions: ArrayLiteralExpression
):
  | { callback: Expression; hotkey: Expression; options: Expression | null }[]
  | null => {
  const entries: {
    callback: Expression;
    hotkey: Expression;
    options: Expression | null;
  }[] = [];

  for (const element of definitions.elements) {
    if (!isObjectLiteralExpression(element)) {
      return null;
    }

    const read = (name: string): Expression | null => {
      for (const property of element.properties) {
        if (
          isPropertyAssignment(property) &&
          (isIdentifier(property.name) || isStringLiteral(property.name)) &&
          property.name.text === name
        ) {
          return property.initializer;
        }
      }

      return null;
    };

    const callback = read("callback");
    const hotkey = read("hotkey");

    if (!(callback && hotkey)) {
      return null;
    }

    entries.push({ callback, hotkey, options: read("options") });
  }

  return entries;
};

const createHotkey = (
  file: ParsedSourceFile,
  library: HotkeyLibrary,
  keyExpression: Expression,
  callbackExpression: Expression,
  optionsExpression: Expression | undefined
): DeclarativeHotkey | null => {
  const specs = getStaticKeySpecs(keyExpression);

  if (!(specs && specs.length > 0 && isFunctionNode(callbackExpression))) {
    return null;
  }

  const optionsResult = readOptionsArgument(optionsExpression);

  if (!optionsResult) {
    return null;
  }

  return {
    callback: callbackExpression,
    guardsTypingTargets: guardsTypingTargets(
      library,
      optionsResult.options,
      specs
    ),
    line:
      file.sourceFile.getLineAndCharacterOfPosition(
        keyExpression.getStart(file.sourceFile)
      ).line + 1,
    targetsDKey: specs.some(specTargetsDKey),
  };
};

const readTanstackBulkCall = (
  file: ParsedSourceFile,
  call: CallExpression
): DeclarativeHotkey[] => {
  const [definitionsArgument, commonOptions] = call.arguments;

  if (!(definitionsArgument && isArrayLiteralExpression(definitionsArgument))) {
    return [];
  }

  const definitions = readTanstackDefinitions(definitionsArgument);

  if (!definitions) {
    return [];
  }

  return definitions.flatMap((definition) => {
    // Per-hotkey options are merged on top of commonOptions; prefer the
    // specific one and fall back to the shared one.
    const hotkey = createHotkey(
      file,
      "tanstack",
      definition.hotkey,
      definition.callback,
      definition.options ?? commonOptions
    );

    return hotkey ? [hotkey] : [];
  });
};

const readHotkeyCall = (
  file: ParsedSourceFile,
  call: CallExpression
): DeclarativeHotkey[] => {
  if (!isIdentifier(call.expression)) {
    return [];
  }

  const localName = call.expression.text;
  const hotkeyModule = getHotkeyModuleForLocalName(file, localName);

  if (!hotkeyModule || hasLocalDeclaration(file, localName)) {
    return [];
  }

  if (hotkeyModule.library === "tanstack" && localName === "useHotkeys") {
    return readTanstackBulkCall(file, call);
  }

  const [keyArgument, callbackArgument, optionsArgument] = call.arguments;

  if (!(keyArgument && callbackArgument)) {
    return [];
  }

  const hotkey = createHotkey(
    file,
    hotkeyModule.library,
    keyArgument,
    callbackArgument,
    optionsArgument
  );

  return hotkey ? [hotkey] : [];
};

/**
 * Finds declarative dark-mode hotkey registrations, each paired with a
 * scope covering only its callback so the theme-toggle check reads the
 * handler rather than the whole component.
 */
const findDeclarativeHotkeyScopes = (
  file: ParsedSourceFile
): { hotkey: DeclarativeHotkey; scope: SourceScope }[] => {
  const results: { hotkey: DeclarativeHotkey; scope: SourceScope }[] = [];

  walkNodes(file.sourceFile, (node) => {
    if (!isCallExpression(node)) {
      return true;
    }

    for (const hotkey of readHotkeyCall(file, node)) {
      const start = hotkey.callback.getStart(file.sourceFile);
      const end = hotkey.callback.getEnd();

      results.push({
        hotkey,
        scope: {
          content: file.content.slice(start, end),
          end,
          file,
          line: hotkey.line,
          start,
        },
      });
    }

    return true;
  });

  return results;
};

export type { DeclarativeHotkey };
export { findDeclarativeHotkeyScopes, HOTKEY_MODULES };
