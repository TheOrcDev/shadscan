import type { AuditRule } from "../audit";
import { fail, pass } from "./rule-result";
import { getProjectSourceFiles, getProjectStyleFiles } from "./source-files";

const CLASS_VALUE_PATTERN =
  /className\s*=\s*(?:["'`]([^"'`]*outline-none[^"'`]*)["'`]|\{[^}]*["'`]([^"'`]*outline-none[^"'`]*)["'`][^}]*\})/g;
const FOCUS_REPLACEMENT_PATTERN =
  /focus-visible:(?:ring|outline|border|shadow)|focus:(?:ring|outline|border|shadow)/;
const CSS_RULE_PATTERN = /([^{}]+)\{([^{}]*)\}/g;
const CSS_OUTLINE_REMOVAL_PATTERN = /outline\s*:\s*(?:none|0)\s*;/i;
const CSS_VISIBLE_PROPERTY_PATTERN =
  /^(?:border(?:-color|-style|-width)?|box-shadow|outline)$/i;
const FOCUS_PSEUDO_PATTERN = /:(?:focus-visible|focus-within|focus)\b/;
const ALL_FOCUS_PSEUDOS_PATTERN = /:(?:focus-visible|focus-within|focus)\b/g;

interface CssRule {
  body: string;
  index: number;
  selectors: string[];
}

const parseCssRules = (css: string): CssRule[] =>
  [...css.matchAll(CSS_RULE_PATTERN)].map((match) => ({
    body: match[2] ?? "",
    index: match.index,
    selectors: (match[1] ?? "")
      .split(",")
      .map((selector) => selector.trim())
      .filter(Boolean),
  }));

const getBaseSelector = (selector: string): string =>
  selector.replace(ALL_FOCUS_PSEUDOS_PATTERN, "").replace(/\s+/g, " ").trim();

const hasVisibleFocusStyle = (body: string): boolean =>
  body.split(";").some((declaration) => {
    const separatorIndex = declaration.indexOf(":");

    if (separatorIndex < 0) {
      return false;
    }

    const property = declaration.slice(0, separatorIndex).trim();
    const value = declaration
      .slice(separatorIndex + 1)
      .trim()
      .toLowerCase();

    return (
      CSS_VISIBLE_PROPERTY_PATTERN.test(property) &&
      value !== "" &&
      value !== "0" &&
      value !== "none"
    );
  });

const hasMatchingFocusReplacement = (
  removalSelector: string,
  rules: CssRule[]
): boolean => {
  const baseSelector = getBaseSelector(removalSelector);

  return rules.some(
    (rule) =>
      hasVisibleFocusStyle(rule.body) &&
      rule.selectors.some(
        (selector) =>
          FOCUS_PSEUDO_PATTERN.test(selector) &&
          getBaseSelector(selector) === baseSelector
      )
  );
};

const focusVisibleNotSuppressedRule: AuditRule = {
  adapters: ["core"],
  category: "interaction",
  confidence: "medium",
  description:
    "Checks explicit focus-outline removal for a visible replacement style.",
  id: "focus-visible-not-suppressed",
  maxScore: 3,
  run: async ({ project }) => {
    const sourceFiles = await getProjectSourceFiles(project);

    for (const file of sourceFiles) {
      CLASS_VALUE_PATTERN.lastIndex = 0;

      for (const match of file.content.matchAll(CLASS_VALUE_PATTERN)) {
        const classValue = match[1] ?? match[2] ?? "";

        if (!FOCUS_REPLACEMENT_PATTERN.test(classValue)) {
          const line = file.content.slice(0, match.index).split("\n").length;
          return fail(
            "A control removes its focus outline without a visible replacement.",
            "Add a focus-visible ring, outline, border, or shadow before suppressing the default outline.",
            { filePath: file.path, line }
          );
        }
      }
    }

    const styleFiles = await getProjectStyleFiles(project);

    for (const file of styleFiles) {
      const rules = parseCssRules(file.content);

      for (const rule of rules) {
        if (!CSS_OUTLINE_REMOVAL_PATTERN.test(rule.body)) {
          continue;
        }

        const selectorsWithoutReplacement = rule.selectors.filter(
          (selector) =>
            !(
              hasVisibleFocusStyle(rule.body) ||
              hasMatchingFocusReplacement(selector, rules)
            )
        );

        if (selectorsWithoutReplacement.length > 0) {
          return fail(
            `CSS removes focus outlines from ${selectorsWithoutReplacement.join(", ")} without a matching visible replacement.`,
            "Provide a visible focus-visible style for the same selector before removing user-agent outlines.",
            {
              filePath: file.path,
              line: file.content.slice(0, rule.index).split("\n").length,
            }
          );
        }
      }
    }

    return pass("No uncorrected focus-outline suppression was found.");
  },
  severity: "error",
  title: "focus indicators are not suppressed",
};

export { focusVisibleNotSuppressedRule };
