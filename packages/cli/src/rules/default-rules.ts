import { accessibilityRules } from "./accessibility";
import { asyncActionPendingStateRule } from "./async-action-pending-state";
import { commandMenuHotkeyPresentRule } from "./command-menu-hotkey-present";
import { commandMenuPresentRule } from "./command-menu-present";
import { componentsAliasesResolveRule } from "./components-aliases-resolve";
import { emptyStatePresentRule } from "./empty-state-present";
import { errorStateRetryPresentRule } from "./error-state-retry-present";
import { focusVisibleNotSuppressedRule } from "./focus-visible-not-suppressed";
import { globalHotkeysAreSafeRule } from "./global-hotkeys-are-safe";
import { highConfidenceRules } from "./high-confidence";
import { htmlLangPresentRule } from "./html-lang-present";
import { metadataTitleDescriptionCompleteRule } from "./metadata-title-description-complete";
import { mobileNavPresentRule } from "./mobile-nav-present";
import { noStarterCopyRule } from "./no-starter-copy";
import { notFoundRecoveryPresentRule } from "./not-found-recovery-present";
import { routeLoadingBoundaryPresentRule } from "./route-loading-boundary-present";
import { socialPreviewPresentRule } from "./social-preview-present";
import { suspenseFallbackUsefulRule } from "./suspense-fallback-useful";
import { themeHydrationSafeRule } from "./theme-hydration-safe";
import { themeProviderMountedInShellRule } from "./theme-provider-mounted-in-shell";
import { toastProviderMountedRule } from "./toast-provider-mounted";

const defaultRules = [
  ...highConfidenceRules,
  componentsAliasesResolveRule,
  themeProviderMountedInShellRule,
  themeHydrationSafeRule,
  htmlLangPresentRule,
  metadataTitleDescriptionCompleteRule,
  socialPreviewPresentRule,
  noStarterCopyRule,
  commandMenuPresentRule,
  commandMenuHotkeyPresentRule,
  globalHotkeysAreSafeRule,
  mobileNavPresentRule,
  focusVisibleNotSuppressedRule,
  routeLoadingBoundaryPresentRule,
  suspenseFallbackUsefulRule,
  emptyStatePresentRule,
  errorStateRetryPresentRule,
  notFoundRecoveryPresentRule,
  asyncActionPendingStateRule,
  toastProviderMountedRule,
  ...accessibilityRules,
];

export { defaultRules };
