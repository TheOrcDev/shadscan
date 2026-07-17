import { isJsxElement, isJsxSelfClosingElement } from "typescript";
import {
  getJsxAttribute,
  getJsxTagName,
  getLineNumber,
  hasJsxAttribute,
  parseProjectSourceFiles,
  visitJsxNodes,
} from "../ast";
import type { AuditRule, AuditRuleResult } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";

const INPUT_TAGS = new Set(["Input", "input"]);
const PERSONAL_INPUT_TYPES = new Set(["email", "password", "tel"]);
const PERSONAL_FIELD_PATTERN =
  /(?:^|-)(?:address|bday|cc|country|credit-card|current-password|email|family-name|first-name|given-name|last-name|name|new-password|organization|phone|postal|street|tel|username|zip)(?:-|$)/;
const GENERATED_UI_PATH_PATTERN = /[/\\]components[/\\]ui[/\\]/;

const normalizeFieldName = (value: string): string =>
  value
    .replace(/([a-z\d])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();

const isPersonalDataInput = (
  name: string | true | null,
  id: string | true | null,
  type: string | true | null
): boolean => {
  if (
    typeof type === "string" &&
    PERSONAL_INPUT_TYPES.has(type.toLowerCase())
  ) {
    return true;
  }

  return [name, id].some(
    (value) =>
      typeof value === "string" &&
      PERSONAL_FIELD_PATTERN.test(normalizeFieldName(value))
  );
};

const personalDataAutocompletePresentRule: AuditRule = {
  adapters: ["core"],
  category: "forms",
  confidence: "high",
  description:
    "Checks fields collecting personal data for an explicit autocomplete purpose.",
  id: "personal-data-autocomplete-present",
  maxScore: 2,
  run: async ({ project }) => {
    const files = (await parseProjectSourceFiles(project)).filter(
      (file) => !GENERATED_UI_PATH_PATTERN.test(file.filePath)
    );
    let personalFieldCount = 0;
    let failure: AuditRuleResult | null = null;

    visitJsxNodes(files, ({ file, node }) => {
      if (failure || !(isJsxElement(node) || isJsxSelfClosingElement(node))) {
        return;
      }

      const openingElement = isJsxElement(node) ? node.openingElement : node;
      const tagName = getJsxTagName(openingElement);

      if (
        !(
          tagName &&
          INPUT_TAGS.has(tagName) &&
          isPersonalDataInput(
            getJsxAttribute(openingElement, "name"),
            getJsxAttribute(openingElement, "id"),
            getJsxAttribute(openingElement, "type")
          )
        )
      ) {
        return;
      }

      personalFieldCount += 1;

      if (hasJsxAttribute(openingElement, "autoComplete")) {
        return;
      }

      failure = fail(
        `${tagName} collects personal data without an autocomplete purpose.`,
        "Add the appropriate autoComplete token, such as email, name, tel, or current-password.",
        {
          filePath: file.filePath,
          line: getLineNumber(file, openingElement),
        }
      );
    });

    if (failure) {
      return failure;
    }

    if (personalFieldCount === 0) {
      return notApplicable("No personal-data inputs were found.");
    }

    return pass(
      `All ${personalFieldCount} personal-data inputs declare autocomplete purposes.`
    );
  },
  severity: "warning",
  title: "personal-data fields declare autocomplete purposes",
};

export { personalDataAutocompletePresentRule };
