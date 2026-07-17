import { accessibilityRules } from "./accessibility";
import { animationsRespectReducedMotionRule } from "./animations-respect-reduced-motion";
import { asyncActionPendingStateRule } from "./async-action-pending-state";
import { commandMenuHotkeyPresentRule } from "./command-menu-hotkey-present";
import { commandMenuPresentRule } from "./command-menu-present";
import { componentsAliasesResolveRule } from "./components-aliases-resolve";
import { customControlsHaveLabelsRule } from "./custom-controls-have-labels";
import { destructiveActionsConfirmedRule } from "./destructive-actions-confirmed";
import { dialogFocusTrapWorksRule } from "./dialog-focus-trap-works";
import { emptyStatePresentRule } from "./empty-state-present";
import { errorStateRetryPresentRule } from "./error-state-retry-present";
import { fieldErrorsRenderedRule } from "./field-errors-rendered";
import { focusVisibleNotSuppressedRule } from "./focus-visible-not-suppressed";
import { formButtonsHaveExplicitTypeRule } from "./form-buttons-have-explicit-type";
import { globalHotkeysAreSafeRule } from "./global-hotkeys-are-safe";
import { groupedControlsHaveLegendRule } from "./grouped-controls-have-legend";
import { headingStructureSaneRule } from "./heading-structure-sane";
import { highConfidenceRules } from "./high-confidence";
import { htmlLangPresentRule } from "./html-lang-present";
import { iframesHaveTitleRule } from "./iframes-have-title";
import { imagesHaveAltRule } from "./images-have-alt";
import { invalidFieldsAssociatedWithErrorsRule } from "./invalid-fields-associated-with-errors";
import { linksHaveAccessibleNamesRule } from "./links-have-accessible-names";
import { metadataTitleDescriptionCompleteRule } from "./metadata-title-description-complete";
import { mobileNavPresentRule } from "./mobile-nav-present";
import { navLandmarksHaveNamesRule } from "./nav-landmarks-have-names";
import { noNestedInteractiveControlsRule } from "./no-nested-interactive-controls";
import { noPositiveTabindexRule } from "./no-positive-tabindex";
import { noStarterCopyRule } from "./no-starter-copy";
import { notFoundRecoveryPresentRule } from "./not-found-recovery-present";
import { personalDataAutocompletePresentRule } from "./personal-data-autocomplete-present";
import { publicAppSeoFilesPresentRule } from "./public-app-seo-files-present";
import { responsiveShellPresentRule } from "./responsive-shell-present";
import { routeLoadingBoundaryPresentRule } from "./route-loading-boundary-present";
import { socialPreviewPresentRule } from "./social-preview-present";
import { statusMessagesAnnouncedRule } from "./status-messages-announced";
import { suspenseFallbackUsefulRule } from "./suspense-fallback-useful";
import { themeHydrationSafeRule } from "./theme-hydration-safe";
import { themeProviderMountedInShellRule } from "./theme-provider-mounted-in-shell";
import { toastProviderMountedRule } from "./toast-provider-mounted";
import { validationWiredToFormRule } from "./validation-wired-to-form";

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
  imagesHaveAltRule,
  linksHaveAccessibleNamesRule,
  customControlsHaveLabelsRule,
  noPositiveTabindexRule,
  iframesHaveTitleRule,
  navLandmarksHaveNamesRule,
  noNestedInteractiveControlsRule,
  statusMessagesAnnouncedRule,
  validationWiredToFormRule,
  fieldErrorsRenderedRule,
  invalidFieldsAssociatedWithErrorsRule,
  groupedControlsHaveLegendRule,
  formButtonsHaveExplicitTypeRule,
  personalDataAutocompletePresentRule,
  headingStructureSaneRule,
  responsiveShellPresentRule,
  destructiveActionsConfirmedRule,
  animationsRespectReducedMotionRule,
  publicAppSeoFilesPresentRule,
  dialogFocusTrapWorksRule,
  ...accessibilityRules,
];

export { defaultRules };
