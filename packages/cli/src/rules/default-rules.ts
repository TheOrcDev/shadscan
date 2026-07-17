import { accessibilityRules } from "./accessibility";
import { componentsAliasesResolveRule } from "./components-aliases-resolve";
import { highConfidenceRules } from "./high-confidence";
import { themeProviderMountedInShellRule } from "./theme-provider-mounted-in-shell";

const defaultRules = [
  ...highConfidenceRules,
  componentsAliasesResolveRule,
  themeProviderMountedInShellRule,
  ...accessibilityRules,
];

export { defaultRules };
