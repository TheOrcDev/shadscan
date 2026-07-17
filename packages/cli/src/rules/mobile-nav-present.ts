import { findOwnedSourceScopes } from "../ast";
import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";

const NAVIGATION_PATTERN = /<(?:nav|NavigationMenu|Sidebar)(?:\s|>)/;
const MOBILE_PANEL_PATTERN = /<(?:SheetContent|DrawerContent|Sidebar)(?:\s|>)/;
const MOBILE_TRIGGER_PATTERN =
  /<(?:SheetTrigger|DrawerTrigger|SidebarTrigger)(?:\s|>)|aria-label=["'][^"']*(?:menu|navigation)[^"']*["']|<(?:Menu|MenuIcon)(?:\s|>)/i;
const RESPONSIVE_PATTERN =
  /(?:sm:hidden|md:hidden|lg:hidden|useIsMobile|openMobile|data-mobile)/;
const GENERATED_UI_PATH_PATTERN = /[/\\]components[/\\]ui[/\\]/;

const mobileNavPresentRule: AuditRule = {
  adapters: ["core"],
  category: "interaction",
  confidence: "medium",
  description:
    "Checks apps with navigation for a responsive mobile trigger and panel.",
  id: "mobile-nav-present",
  maxScore: 3,
  run: async ({ project }) => {
    const navigationScopes = (
      await findOwnedSourceScopes(project, NAVIGATION_PATTERN)
    ).filter((scope) => !GENERATED_UI_PATH_PATTERN.test(scope.file.filePath));

    if (navigationScopes.length === 0) {
      return notApplicable("No app-level navigation was found.");
    }

    for (const scope of navigationScopes) {
      const hasPanel = MOBILE_PANEL_PATTERN.test(scope.content);
      const hasTrigger = MOBILE_TRIGGER_PATTERN.test(scope.content);
      const hasResponsiveBehavior = RESPONSIVE_PATTERN.test(scope.content);

      if (hasPanel && hasTrigger && hasResponsiveBehavior) {
        return pass(
          "Responsive mobile navigation trigger and panel found in one navigation surface.",
          scope.file.filePath,
          scope.line
        );
      }
    }

    const navigationScope = navigationScopes[0];
    const hasPanel = MOBILE_PANEL_PATTERN.test(navigationScope?.content ?? "");
    const hasTrigger = MOBILE_TRIGGER_PATTERN.test(
      navigationScope?.content ?? ""
    );
    const hasResponsiveBehavior = RESPONSIVE_PATTERN.test(
      navigationScope?.content ?? ""
    );
    const missing = [
      hasTrigger ? null : "a mobile navigation trigger",
      hasPanel ? null : "an off-canvas mobile panel",
      hasResponsiveBehavior ? null : "responsive mobile behavior",
    ].filter((item): item is string => item !== null);

    return fail(
      `Navigation is missing ${missing.join(", ")}.`,
      "Add a responsive Sheet, Drawer, or Sidebar trigger and panel for small screens.",
      {
        filePath: navigationScope?.file.filePath,
        line: navigationScope?.line,
        roast: "Desktop-only navigation in a phone-shaped world. Brave.",
      }
    );
  },
  severity: "warning",
  title: "mobile navigation is present",
};

export { mobileNavPresentRule };
