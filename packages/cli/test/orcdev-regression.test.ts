import { describe, expect, it } from "vitest";
import { runAudit } from "../src/audit";
import { defaultRules } from "../src/rules/default-rules";
import { createRuleFixture } from "./rule-fixture";

const REGRESSION_RULE_IDS = new Set([
  "destructive-actions-confirmed",
  "forms-have-labels",
  "metadata-title-description-complete",
  "mobile-nav-present",
  "mobile-overflow-absent",
  "nav-landmarks-have-names",
  "route-loading-boundary-present",
  "toast-provider-mounted",
  "toast-provider-present",
]);

const regressionRules = defaultRules.filter((rule) =>
  REGRESSION_RULE_IDS.has(rule.id)
);

describe("OrcDev regression contract", () => {
  it("preserves corrected findings across the previously misleading patterns", async () => {
    const fixture = await createRuleFixture({
      next: "16.2.10",
      "radix-ui": "1.4.3",
      react: "19.2.7",
    });

    try {
      await fixture.write(
        "tsconfig.json",
        `${JSON.stringify(
          {
            compilerOptions: {
              baseUrl: ".",
              paths: { "@/*": ["./*"] },
            },
          },
          null,
          2
        )}\n`
      );
      await fixture.write(
        "app/layout.tsx",
        `
          import { Navbar } from "@/components/navbar";
          import { ThemeProvider } from "@/components/theme-provider";
          import { Toaster } from "@/components/ui/toaster";

          export const metadata = {
            title: "OrcDev",
            description: "Practical web development resources.",
          };

          export default function Layout({ children }) {
            return (
              <html lang="en">
                <body>
                  <ThemeProvider>
                    <Navbar />
                    {children}
                    <Toaster />
                  </ThemeProvider>
                </body>
              </html>
            );
          }
        `
      );
      await fixture.write(
        "components/theme-provider.tsx",
        `
          import { ThemeProvider as NextThemesProvider } from "next-themes";

          export function ThemeProvider({ children }) {
            return <NextThemesProvider attribute="class">{children}</NextThemesProvider>;
          }
        `
      );
      await fixture.write(
        "components/ui/toaster.tsx",
        `
          import { ToastProvider, ToastViewport } from "@/components/ui/toast";
          export function Toaster() {
            return <ToastProvider><ToastViewport /></ToastProvider>;
          }
        `
      );
      await fixture.write(
        "components/ui/toast.tsx",
        `
          import { Toast as ToastPrimitives } from "radix-ui";
          export const ToastProvider = ToastPrimitives.Provider;
          export const ToastViewport = ToastPrimitives.Viewport;
        `
      );
      await fixture.write(
        "app/blog/[slug]/page.tsx",
        `
          export const metadata = {
            title: "Article",
            openGraph: { images: ["/article.png"] },
          };
          export const dynamicParams = false;
          export function generateStaticParams() { return [{ slug: "first" }]; }
          export default async function Post({ params }) {
            const { slug } = await params;
            return <article>{slug}</article>;
          }
        `
      );
      await fixture.write(
        "app/videos/page.tsx",
        `
          export const dynamic = "force-dynamic";
          export default async function Videos() {
            const videos = await getVideos();
            return <main>{videos.length}</main>;
          }
        `
      );
      await fixture.write(
        "components/navbar.tsx",
        `
          import { Button } from "@/components/ui/button";
          import {
            NavigationMenu,
            NavigationMenuItem,
            NavigationMenuList,
          } from "@/components/ui/navigation-menu";

          const ITEMS = [
            { href: "/sponsor-me", label: "Sponsor Me" },
            { href: "/my-sponsors", label: "Sponsors" },
          ];

          export function Navbar() {
            const [isMenuOpen, setIsMenuOpen] = useState(false);
            return (
              <>
                <NavigationMenu className="max-lg:hidden">
                  <NavigationMenuList>
                    {ITEMS.map((link) => (
                      <NavigationMenuItem key={link.label}>
                        <a href={link.href}>{link.label}</a>
                      </NavigationMenuItem>
                    ))}
                  </NavigationMenuList>
                </NavigationMenu>
                <Button
                  className="lg:hidden"
                  onClick={() => setIsMenuOpen(!isMenuOpen)}
                >
                  <span className="sr-only">Open main menu</span>
                </Button>
                <div className={cn("lg:hidden", isMenuOpen ? "visible" : "invisible")}>
                  <nav>
                    {ITEMS.map((link) => (
                      <a href={link.href} key={link.label}>{link.label}</a>
                    ))}
                  </nav>
                </div>
              </>
            );
          }
        `
      );
      await fixture.write(
        "components/ui/button.tsx",
        `
          export function Button({ children, ...props }) {
            return <button {...props}>{children}</button>;
          }
        `
      );
      await fixture.write(
        "components/ui/navigation-menu.tsx",
        `
          import * as NavigationMenuPrimitive from "@radix-ui/react-navigation-menu";

          export function NavigationMenu({
            children,
            className,
            viewport = true,
            ...props
          }) {
            return (
              <NavigationMenuPrimitive.Root
                className={cn("relative flex max-w-max flex-1 items-center", className)}
                {...props}
              >
                {children}
                {viewport ? <NavigationMenuViewport /> : null}
              </NavigationMenuPrimitive.Root>
            );
          }

          export function NavigationMenuList({ className, ...props }) {
            return (
              <NavigationMenuPrimitive.List
                className={cn("flex list-none", className)}
                {...props}
              />
            );
          }

          export function NavigationMenuItem({ className, ...props }) {
            return (
              <NavigationMenuPrimitive.Item
                className={cn("relative", className)}
                {...props}
              />
            );
          }

          function NavigationMenuViewport({ className, ...props }) {
            return (
              <div className="absolute top-full">
                <NavigationMenuPrimitive.Viewport
                  className={cn("relative", className)}
                  {...props}
                />
              </div>
            );
          }
        `
      );
      await fixture.write(
        "components/ui/input.tsx",
        `
          export function Input(props) {
            return <input data-slot="input" {...props} />;
          }
        `
      );
      await fixture.write(
        "components/newsletter.tsx",
        `
          export function Newsletter() {
            return (
              <FormItem>
                <FormControl><Input placeholder="Email" /></FormControl>
                <FormMessage />
              </FormItem>
            );
          }
        `
      );
      await fixture.write(
        "components/equipment.tsx",
        'export function Equipment() { return <Badge variant="destructive">Coming soon</Badge>; }'
      );
      await fixture.write(
        "components/project-grid.tsx",
        'export function ProjectGrid() { return <Image fill sizes="(min-width: 640px) 50vw, 100vw" />; }'
      );

      expect(regressionRules).toHaveLength(REGRESSION_RULE_IDS.size);

      const report = await runAudit(fixture.rootDir, {
        rules: regressionRules,
      });
      const findings = new Map(
        report.findings.map((finding) => [finding.id, finding])
      );

      for (const id of [
        "metadata-title-description-complete",
        "mobile-nav-present",
        "nav-landmarks-have-names",
        "toast-provider-mounted",
        "toast-provider-present",
      ]) {
        const finding = findings.get(id);
        expect(
          finding?.status,
          `${id}: ${finding?.evidence.map((item) => item.message).join(" | ")}`
        ).toBe("pass");
      }

      const loadingFinding = findings.get("route-loading-boundary-present");
      expect(loadingFinding?.status).toBe("fail");
      expect(loadingFinding?.evidence[0]?.filePath).toBe("app/videos/page.tsx");

      const formFinding = findings.get("forms-have-labels");
      expect(formFinding?.status).toBe("fail");
      expect(formFinding?.evidence[0]?.filePath).toBe(
        "components/newsletter.tsx"
      );

      expect(findings.get("destructive-actions-confirmed")?.status).toBe(
        "not-applicable"
      );

      const overflowFinding = findings.get("mobile-overflow-absent");
      expect(overflowFinding?.status).toBe("advisory");
      expect(overflowFinding?.evidence[0]?.message).not.toContain(
        "overflow-prone"
      );
      expect(overflowFinding?.evidence[0]?.filePath).toBeUndefined();
    } finally {
      await fixture.cleanup();
    }
  });
});
