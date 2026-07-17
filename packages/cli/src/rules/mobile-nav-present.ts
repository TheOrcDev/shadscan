import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";
import { getProjectSourceFiles, getTextLineNumber } from "./source-files";

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
    const files = (await getProjectSourceFiles(project)).filter(
      (file) => !GENERATED_UI_PATH_PATTERN.test(file.path)
    );
    const navigationFile = files.find((file) =>
      NAVIGATION_PATTERN.test(file.content)
    );

    if (!navigationFile) {
      return notApplicable("No app-level navigation was found.");
    }

    const hasPanel = files.some((file) =>
      MOBILE_PANEL_PATTERN.test(file.content)
    );
    const hasTrigger = files.some((file) =>
      MOBILE_TRIGGER_PATTERN.test(file.content)
    );
    const hasResponsiveBehavior = files.some((file) =>
      RESPONSIVE_PATTERN.test(file.content)
    );

    if (hasPanel && hasTrigger && hasResponsiveBehavior) {
      return pass(
        "Responsive mobile navigation trigger and panel found.",
        navigationFile.path,
        getTextLineNumber(navigationFile.content, NAVIGATION_PATTERN)
      );
    }

    const missing = [
      hasTrigger ? null : "a mobile navigation trigger",
      hasPanel ? null : "an off-canvas mobile panel",
      hasResponsiveBehavior ? null : "responsive mobile behavior",
    ].filter((item): item is string => item !== null);

    return fail(
      `Navigation is missing ${missing.join(", ")}.`,
      "Add a responsive Sheet, Drawer, or Sidebar trigger and panel for small screens.",
      {
        filePath: navigationFile.path,
        line: getTextLineNumber(navigationFile.content, NAVIGATION_PATTERN),
        roast: "Desktop-only navigation in a phone-shaped world. Brave.",
      }
    );
  },
  severity: "warning",
  title: "mobile navigation is present",
};

export { mobileNavPresentRule };
