import path from "node:path";
import {
  type Expression,
  isArrayLiteralExpression,
  isCallExpression,
  isExportAssignment,
  isIdentifier,
  isNewExpression,
  isObjectLiteralExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isStringLiteralLike,
  type ObjectLiteralExpression,
  type PropertyName,
} from "typescript";
import type { ParsedSourceFile } from "../ast";

const VITE_CONFIG_PATTERN = /^vite\.config\.[cm]?[jt]s$/;

const getPropertyName = (name: PropertyName): string | null => {
  if (isIdentifier(name) || isStringLiteralLike(name)) {
    return name.text;
  }

  return null;
};

const getObjectProperty = (
  object: ObjectLiteralExpression,
  propertyName: string
): Expression | null => {
  for (const property of object.properties) {
    if (
      isPropertyAssignment(property) &&
      getPropertyName(property.name) === propertyName
    ) {
      return property.initializer;
    }
  }

  return null;
};

const unwrapConfigExpression = (
  expression: Expression
): ObjectLiteralExpression | null => {
  if (isObjectLiteralExpression(expression)) {
    return expression;
  }

  if (isCallExpression(expression)) {
    const argument = expression.arguments[0];
    return argument && isObjectLiteralExpression(argument) ? argument : null;
  }

  return null;
};

const resolvePathCall = (
  expression: Expression,
  configDirectory: string
): string | null => {
  if (!isCallExpression(expression)) {
    return null;
  }

  const isResolveCall =
    (isIdentifier(expression.expression) &&
      expression.expression.text === "resolve") ||
    (isPropertyAccessExpression(expression.expression) &&
      expression.expression.name.text === "resolve");

  if (isResolveCall) {
    const segments = expression.arguments.flatMap((argument) =>
      isStringLiteralLike(argument) ? [argument.text] : []
    );
    const hasDirectoryBase = expression.arguments.some(
      (argument) => isIdentifier(argument) && argument.text === "__dirname"
    );

    if (hasDirectoryBase && segments.length > 0) {
      return path.resolve(configDirectory, ...segments);
    }
  }

  const argument = expression.arguments[0];
  if (
    !(
      isIdentifier(expression.expression) &&
      expression.expression.text === "fileURLToPath" &&
      argument &&
      isNewExpression(argument) &&
      isIdentifier(argument.expression) &&
      argument.expression.text === "URL"
    )
  ) {
    return null;
  }

  const relativePath = argument.arguments?.[0];
  return relativePath && isStringLiteralLike(relativePath)
    ? path.resolve(configDirectory, relativePath.text)
    : null;
};

const resolveAliasTarget = (
  expression: Expression,
  configDirectory: string
): string | null => {
  if (isStringLiteralLike(expression)) {
    return path.isAbsolute(expression.text) ? expression.text : null;
  }

  return resolvePathCall(expression, configDirectory);
};

const addObjectAliases = (
  aliases: Map<string, string>,
  object: ObjectLiteralExpression,
  configDirectory: string
): boolean => {
  let partial = false;

  for (const property of object.properties) {
    if (!isPropertyAssignment(property)) {
      partial = true;
      continue;
    }

    const alias = getPropertyName(property.name);
    const target = resolveAliasTarget(property.initializer, configDirectory);
    if (alias && target) {
      aliases.set(alias, target);
    } else {
      partial = true;
    }
  }

  return partial;
};

const addArrayAliases = (
  aliases: Map<string, string>,
  expression: Expression,
  configDirectory: string
): boolean => {
  if (!isArrayLiteralExpression(expression)) {
    return true;
  }

  let partial = false;
  for (const element of expression.elements) {
    if (!isObjectLiteralExpression(element)) {
      partial = true;
      continue;
    }

    const find = getObjectProperty(element, "find");
    const replacement = getObjectProperty(element, "replacement");
    const alias = find && isStringLiteralLike(find) ? find.text : null;
    const target = replacement
      ? resolveAliasTarget(replacement, configDirectory)
      : null;
    if (alias && target) {
      aliases.set(alias, target);
    } else {
      partial = true;
    }
  }

  return partial;
};

interface ViteAliasParseResult {
  aliases: Map<string, string>;
  partial: boolean;
}

const addConfigAliases = (
  aliases: Map<string, string>,
  parsed: ParsedSourceFile
): { declared: boolean; partial: boolean } => {
  let declared = false;
  let partial = false;

  for (const statement of parsed.sourceFile.statements) {
    if (!isExportAssignment(statement)) {
      continue;
    }

    const config = unwrapConfigExpression(statement.expression);
    const resolve = config ? getObjectProperty(config, "resolve") : null;
    const alias =
      resolve && isObjectLiteralExpression(resolve)
        ? getObjectProperty(resolve, "alias")
        : null;
    if (!alias) {
      continue;
    }

    declared = true;
    const configDirectory = path.dirname(parsed.filePath);
    if (isObjectLiteralExpression(alias)) {
      const objectPartial = addObjectAliases(aliases, alias, configDirectory);
      partial = partial || objectPartial;
    } else {
      const arrayPartial = addArrayAliases(aliases, alias, configDirectory);
      partial = partial || arrayPartial;
    }
  }

  return { declared, partial };
};

const getViteAliases = (
  parsedFiles: ParsedSourceFile[]
): ViteAliasParseResult => {
  const aliases = new Map<string, string>();
  let partial = false;

  for (const parsed of parsedFiles) {
    if (!VITE_CONFIG_PATTERN.test(path.basename(parsed.filePath))) {
      continue;
    }

    const configResult = addConfigAliases(aliases, parsed);
    partial ||= configResult.declared && configResult.partial;
  }

  return { aliases, partial };
};

export type { ViteAliasParseResult };
export { getViteAliases };
