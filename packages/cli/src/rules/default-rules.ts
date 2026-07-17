import { accessibilityRules } from "./accessibility";
import { componentsAliasesResolveRule } from "./components-aliases-resolve";
import { highConfidenceRules } from "./high-confidence";

const defaultRules = [
  ...highConfidenceRules,
  componentsAliasesResolveRule,
  ...accessibilityRules,
];

export { defaultRules };
