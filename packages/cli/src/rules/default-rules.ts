import { accessibilityRules } from "./accessibility";
import { highConfidenceRules } from "./high-confidence";

const defaultRules = [...highConfidenceRules, ...accessibilityRules];

export { defaultRules };
