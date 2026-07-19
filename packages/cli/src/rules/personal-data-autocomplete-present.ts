import { isJsxElement, isJsxSelfClosingElement } from "typescript";
import {
  getJsxAttribute,
  getJsxAttributeValue,
  getJsxTagName,
  getLineNumber,
  parseProjectSourceFiles,
  visitJsxNodes,
} from "../ast";
import type { AuditRule, AuditRuleResult } from "../audit";
import { advisory, fail, notApplicable, pass } from "./rule-result";

const INPUT_TAGS = new Set(["Input", "input"]);
const PERSONAL_INPUT_TYPES = new Set(["email", "password", "tel"]);
const PERSONAL_FIELD_PATTERN =
  /(?:^|-)(?:address|bday|cc|country|credit-card|current-password|email|family-name|first-name|full-name|given-name|last-name|new-password|organization|phone|postal|street|tel|username|zip)(?:-|$)/;
const EXPLICIT_PERSON_NAME_PATTERN =
  /(?:^|-)(?:contact|customer|display|person|user)-name(?:-|$)/;
const GENERATED_UI_PATH_PATTERN = /[/\\]components[/\\]ui[/\\]/;
const GIVEN_NAME_PATTERN = /(?:first|given)-name/;
const FAMILY_NAME_PATTERN = /(?:family|last)-name/;
const NON_PERSON_NAME_PATTERN =
  /(?:^|-)(?:app|component|event|file|item|package|product|project|repo|repository|resource|team|workspace)-name(?:-|$)/;
const PERSONAL_NAME_CONTEXT_PATH_PATTERN =
  /(?:^|[/\\-])(?:account|billing|checkout|contact|customer|profile|register|registration|shipping|signup|user)(?=[/\\.-]|$)/i;
const WHITESPACE_PATTERN = /\s+/;
const TEL_AUTOCOMPLETE_TOKENS = [
  "tel",
  "tel-area-code",
  "tel-country-code",
  "tel-extension",
  "tel-local",
  "tel-national",
];

const normalizeFieldName = (value: string): string =>
  value
    .replace(/([a-z\d])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();

const isPersonalFieldIdentifier = (
  value: string,
  filePath: string
): boolean => {
  const fieldName = normalizeFieldName(value);

  if (PERSONAL_FIELD_PATTERN.test(fieldName)) {
    return true;
  }

  if (NON_PERSON_NAME_PATTERN.test(fieldName)) {
    return false;
  }

  return (
    EXPLICIT_PERSON_NAME_PATTERN.test(fieldName) ||
    (fieldName === "name" && PERSONAL_NAME_CONTEXT_PATH_PATTERN.test(filePath))
  );
};

const isPersonalDataInput = (
  name: string | true | null,
  id: string | true | null,
  type: string | true | null,
  filePath: string
): boolean => {
  if (
    typeof type === "string" &&
    PERSONAL_INPUT_TYPES.has(type.toLowerCase())
  ) {
    return true;
  }

  return [name, id].some(
    (value) =>
      typeof value === "string" && isPersonalFieldIdentifier(value, filePath)
  );
};

const getNamedFieldTokens = (fieldName: string): string[] => {
  if (fieldName.includes("username")) {
    return ["username"];
  }

  if (GIVEN_NAME_PATTERN.test(fieldName)) {
    return ["given-name"];
  }

  if (FAMILY_NAME_PATTERN.test(fieldName)) {
    return ["family-name"];
  }

  if (fieldName.includes("postal") || fieldName.includes("zip")) {
    return ["postal-code"];
  }

  if (fieldName.includes("address") || fieldName.includes("street")) {
    return [
      "address-line1",
      "address-line2",
      "address-line3",
      "street-address",
    ];
  }

  if (fieldName.includes("country")) {
    return ["country", "country-name"];
  }

  if (fieldName.includes("organization")) {
    return ["organization", "organization-title"];
  }

  if (fieldName.includes("bday")) {
    return ["bday", "bday-day", "bday-month", "bday-year"];
  }

  if (fieldName.includes("cc") || fieldName.includes("credit-card")) {
    return [
      "cc-additional-name",
      "cc-csc",
      "cc-exp",
      "cc-exp-month",
      "cc-exp-year",
      "cc-family-name",
      "cc-given-name",
      "cc-name",
      "cc-number",
      "cc-type",
    ];
  }

  return ["name"];
};

const getExpectedAutocompleteTokens = (
  name: string | true | null,
  id: string | true | null,
  type: string | true | null
): string[] => {
  const fieldName = [name, id]
    .filter((value): value is string => typeof value === "string")
    .map((value) => normalizeFieldName(value))
    .join("-");
  const normalizedType = typeof type === "string" ? type.toLowerCase() : "";

  if (normalizedType === "email" || fieldName.includes("email")) {
    return ["email"];
  }

  if (
    normalizedType === "tel" ||
    fieldName.includes("phone") ||
    fieldName.includes("tel")
  ) {
    return TEL_AUTOCOMPLETE_TOKENS;
  }

  if (fieldName.includes("current-password")) {
    return ["current-password"];
  }

  if (fieldName.includes("new-password")) {
    return ["new-password"];
  }

  if (normalizedType === "password") {
    return fieldName.includes("new")
      ? ["new-password"]
      : ["current-password", "new-password"];
  }

  return getNamedFieldTokens(fieldName);
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
    let uncertainResult: AuditRuleResult | null = null;

    visitJsxNodes(files, ({ file, node }) => {
      if (failure || !(isJsxElement(node) || isJsxSelfClosingElement(node))) {
        return;
      }

      const openingElement = isJsxElement(node) ? node.openingElement : node;
      const tagName = getJsxTagName(openingElement);

      const name = getJsxAttribute(openingElement, "name");
      const id = getJsxAttribute(openingElement, "id");
      const type = getJsxAttribute(openingElement, "type");

      if (
        !(
          tagName &&
          INPUT_TAGS.has(tagName) &&
          isPersonalDataInput(name, id, type, file.filePath)
        )
      ) {
        return;
      }

      personalFieldCount += 1;
      const autocomplete = getJsxAttributeValue(openingElement, "autoComplete");

      if (autocomplete.kind === "dynamic") {
        uncertainResult ??= advisory(
          `${tagName} uses a dynamic autocomplete purpose that cannot be verified statically.`,
          "Ensure it always resolves to the field's expected autocomplete token.",
          file.filePath,
          getLineNumber(file, openingElement)
        );
        return;
      }

      const expectedTokens = getExpectedAutocompleteTokens(name, id, type);
      const declaredTokens =
        autocomplete.kind === "static" && typeof autocomplete.value === "string"
          ? autocomplete.value.toLowerCase().trim().split(WHITESPACE_PATTERN)
          : [];

      if (expectedTokens.some((token) => declaredTokens.includes(token))) {
        return;
      }

      failure = fail(
        `${tagName} does not declare an autocomplete purpose matching this personal-data field.`,
        `Use one of: ${expectedTokens.join(", ")}.`,
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

    return (
      uncertainResult ??
      pass(
        `All ${personalFieldCount} personal-data inputs declare autocomplete purposes.`
      )
    );
  },
  severity: "warning",
  title: "personal-data fields declare autocomplete purposes",
};

export { personalDataAutocompletePresentRule };
