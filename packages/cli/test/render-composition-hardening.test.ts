import { describe, expect, it } from "vitest";
import { buildComponentRenderGraph } from "../src/component-render-graph";
import { discoverProject } from "../src/discovery";
import { navLandmarksHaveNamesRule } from "../src/rules/nav-landmarks-have-names";
import { createRuleFixture, runRule } from "./rule-fixture";

const runNavRule = (rootDir: string) =>
  runRule(rootDir, navLandmarksHaveNamesRule);

const buildGraph = async (rootDir: string) => {
  const project = await discoverProject(rootDir, { filesystemRoot: rootDir });
  return buildComponentRenderGraph(project, rootDir);
};

describe("render composition hardening", () => {
  it("expands returned const aliases, arrays, and comma expressions", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        `
          export function App() {
            const first = <nav aria-label="Shared" />;
            const rendered = [first, <nav aria-label="Shared" />];
            return (void 0, rendered);
          }
        `
      );

      const graph = await buildGraph(fixture.rootDir);
      expect(
        graph.surfaces[0]?.instances.filter(
          (instance) => instance.tagName === "nav"
        )
      ).toHaveLength(2);
      expect((await runNavRule(fixture.rootDir)).status).toBe("fail");
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps unknown nullish ReactNode alternatives partial", async () => {
    const fixture = await createRuleFixture();
    const castFixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        `
          export function App({ slot }) {
            return <main>{slot ?? <nav aria-label="Primary" />}</main>;
          }
        `
      );
      await castFixture.write(
        "src/App.tsx",
        `
          export function App({ slot }) {
            return slot as React.ReactNode;
          }
        `
      );

      expect((await runNavRule(fixture.rootDir)).status).toBe("advisory");
      expect((await runNavRule(castFixture.rootDir)).status).toBe("advisory");
    } finally {
      await Promise.all([fixture.cleanup(), castFixture.cleanup()]);
    }
  });

  it("does not taint navigation with unrelated dynamic return content", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        `
          function Decoration() {
            return createPortal(<span>Decoration</span>, document.body);
          }
          export function App() {
            return <main><nav aria-label="Main" /><Decoration /></main>;
          }
        `
      );

      expect((await runNavRule(fixture.rootDir)).status).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not treat nested scalar member text as navigation", async () => {
    const fixture = await createRuleFixture({
      next: "16.2.10",
      react: "19.2.7",
    });

    try {
      await fixture.write(
        "app/layout.tsx",
        `
          import { Navbar } from "../components/navbar";
          export default function Layout({ children }) {
            return <html><body><Navbar />{children}</body></html>;
          }
        `
      );
      await fixture.write(
        "components/navbar.tsx",
        `
          export function Navbar() {
            return <nav aria-label="Main" />;
          }
        `
      );
      await fixture.write(
        "components/avatar.tsx",
        `
          import * as AvatarPrimitive from "@radix-ui/react-avatar";
          import * as React from "react";
          export const Avatar = React.forwardRef(({ ...props }, ref) => (
            <AvatarPrimitive.Root ref={ref} {...props} />
          ));
          export const AvatarFallback = React.forwardRef(({ ...props }, ref) => (
            <AvatarPrimitive.Fallback ref={ref} {...props} />
          ));
        `
      );
      await fixture.write(
        "app/blog/[slug]/page.tsx",
        `
          import { Avatar, AvatarFallback } from "../../../components/avatar";
          function AuthorName({ author }) {
            return author.name;
          }
          function FormattedTitle({ title }) {
            return format(title);
          }
          function PostHeader({ author, excerpt, title }) {
            return <>
              <h1>{title}</h1>
              <Avatar><AvatarFallback>{author.name}</AvatarFallback></Avatar>
              <p>{excerpt}</p>
            </>;
          }
          export default function Page() {
            return <>
              <PostHeader
                author={{ name: "OrcDev" }}
                excerpt="A practical guide."
                title="Post"
              />
              <AuthorName author={{ name: "OrcDev" }} />
              <FormattedTitle title="Post" />
            </>;
          }
        `
      );

      expect((await runNavRule(fixture.rootDir)).status).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("applies forwarded visibility only to the exact rendered path", async () => {
    const siblingFixture = await createRuleFixture();
    const helperFixture = await createRuleFixture();

    try {
      await siblingFixture.write(
        "src/App.tsx",
        `
          function Nav({ className }) {
            return <><span className={className} /><nav aria-label="Main" /></>;
          }
          export function App() {
            return <><Nav className="max-lg:hidden" /><Nav className="lg:hidden" /></>;
          }
        `
      );
      await helperFixture.write(
        "src/App.tsx",
        `
          function CnNav({ active, className }) {
            return <nav aria-label="cn" className={cn("block", active && "active", className)} />;
          }
          function ClsxNav({ className }) {
            return <nav aria-label="clsx" className={clsx("block", className)} />;
          }
          function ClassnamesNav({ className }) {
            return <nav aria-label="classnames" className={classnames("block", className)} />;
          }
          export function App() {
            return <>
              <CnNav className="max-lg:hidden" /><CnNav className="lg:hidden" />
              <ClsxNav className="max-lg:hidden" /><ClsxNav className="lg:hidden" />
              <ClassnamesNav className="max-lg:hidden" /><ClassnamesNav className="lg:hidden" />
            </>;
          }
        `
      );

      expect((await runNavRule(siblingFixture.rootDir)).status).toBe("fail");
      const helperFinding = await runNavRule(helperFixture.rootDir);
      expect(
        helperFinding.status,
        helperFinding.evidence.map((item) => item.message).join(" | ")
      ).toBe("pass");
    } finally {
      await Promise.all([siblingFixture.cleanup(), helperFixture.cleanup()]);
    }
  });

  it("detects navigation nested inside unknown projection and local map composition", async () => {
    const projectionFixture = await createRuleFixture();
    const mapFixture = await createRuleFixture();

    try {
      await projectionFixture.write(
        "src/App.tsx",
        `
          function Sidebar() { return <nav aria-label="Sidebar" />; }
          function Shell({ children }) { return React.Children.only(children); }
          export function App() {
            return <Shell><section><Sidebar /></section></Shell>;
          }
        `
      );
      await mapFixture.write(
        "src/App.tsx",
        `
          function Sidebar() { return <nav aria-label="Sidebar" />; }
          export function App({ items }) {
            return <main>{items.map(() => <Sidebar />)}</main>;
          }
        `
      );

      expect((await runNavRule(projectionFixture.rootDir)).status).toBe(
        "advisory"
      );
      expect((await runNavRule(mapFixture.rootDir)).status).toBe("advisory");
    } finally {
      await Promise.all([projectionFixture.cleanup(), mapFixture.cleanup()]);
    }
  });

  it("ignores navigation inside an unused nested function", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        `
          function Widget() {
            function Hidden() {
              return <nav aria-label="Hidden" />;
            }
            return <span>Visible</span>;
          }
          export function App({ items }) {
            return <><nav aria-label="Main" />{items.map(() => <Widget />)}</>;
          }
        `
      );

      expect((await runNavRule(fixture.rootDir)).status).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("projects children from object-rest props", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        `
          function Shell({...props}) { return props.children; }
          export function App() {
            return <><Shell><nav aria-label="Shared" /></Shell><nav aria-label="Shared" /></>;
          }
        `
      );

      expect((await runNavRule(fixture.rootDir)).status).toBe("fail");
    } finally {
      await fixture.cleanup();
    }
  });

  it("stops exact extraction after unsupported control flow", async () => {
    const switchFixture = await createRuleFixture();
    const tryFixture = await createRuleFixture();
    const loopFixture = await createRuleFixture();

    try {
      await switchFixture.write(
        "src/App.tsx",
        `
          export function App({ mode }) {
            switch (mode) {
              case "early": return <nav aria-label="Shared" />;
              default: break;
            }
            return <><nav aria-label="Shared" /><nav aria-label="Shared" /></>;
          }
        `
      );
      await tryFixture.write(
        "src/App.tsx",
        `
          export function App({ ready }) {
            try {
              if (ready) return <nav aria-label="Shared" />;
            } finally {
              cleanup();
            }
            return <><nav aria-label="Shared" /><nav aria-label="Shared" /></>;
          }
        `
      );
      await loopFixture.write(
        "src/App.tsx",
        `
          export function App({ items }) {
            for (const item of items) {
              if (item.visible) return <nav aria-label="Shared" />;
            }
            return <><nav aria-label="Shared" /><nav aria-label="Shared" /></>;
          }
        `
      );

      expect((await runNavRule(switchFixture.rootDir)).status).toBe("advisory");
      expect((await runNavRule(tryFixture.rootDir)).status).toBe("advisory");
      expect((await runNavRule(loopFixture.rootDir)).status).toBe("advisory");
    } finally {
      await Promise.all([
        switchFixture.cleanup(),
        tryFixture.cleanup(),
        loopFixture.cleanup(),
      ]);
    }
  });

  it("recognizes complementary simple logical guards", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        `
          function Nav() { return <nav aria-label="Main" />; }
          export function App({ mobile }) {
            return <>{mobile && <Nav />}{!mobile && <Nav />}</>;
          }
        `
      );

      expect((await runNavRule(fixture.rootDir)).status).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("makes literal prop-selected component branches advisory", async () => {
    const fixture = await createRuleFixture();
    const unrelatedFixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        `
          function Nav({ kind }) {
            return kind === "main" ? <nav aria-label="Main" /> : null;
          }
          export function App() {
            return <><Nav kind="main" /><Nav kind="utility" /></>;
          }
        `
      );
      await unrelatedFixture.write(
        "src/App.tsx",
        `
          function Nav({ id, mobile }) {
            return mobile
              ? <nav aria-label="Main" data-id={id} />
              : <nav aria-label="Main" data-id={id} />;
          }
          export function App() {
            return <Nav id="main" />;
          }
        `
      );

      expect((await runNavRule(fixture.rootDir)).status).toBe("advisory");
      expect((await runNavRule(unrelatedFixture.rootDir)).status).toBe("pass");
    } finally {
      await Promise.all([fixture.cleanup(), unrelatedFixture.cleanup()]);
    }
  });

  it("projects next-themes provider children exactly once", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/theme-provider.tsx",
        `
          import { ThemeProvider as NextThemesProvider } from "next-themes";
          export function ThemeProvider({ children }) {
            return <NextThemesProvider>{children}</NextThemesProvider>;
          }
        `
      );
      await fixture.write(
        "src/App.tsx",
        `
          import { ThemeProvider } from "./theme-provider";
          export function App() {
            return <ThemeProvider><nav aria-label="Main" /></ThemeProvider>;
          }
        `
      );

      const graph = await buildGraph(fixture.rootDir);
      expect(
        graph.surfaces[0]?.instances.filter(
          (instance) => instance.tagName === "nav"
        )
      ).toHaveLength(1);
      expect((await runNavRule(fixture.rootDir)).status).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("projects only recognized Radix navigation roots", async () => {
    const radixPackageFixture = await createRuleFixture();
    const radixUiFixture = await createRuleFixture();

    try {
      await radixPackageFixture.write(
        "src/navigation-menu.tsx",
        `
          import * as NavigationMenuPrimitive from "@radix-ui/react-navigation-menu";
          export function NavigationMenu({ children }) {
            return <NavigationMenuPrimitive.Root>{children}</NavigationMenuPrimitive.Root>;
          }
          export function NavigationMenuList({ ...props }) {
            return <NavigationMenuPrimitive.List {...props} />;
          }
          export function NavigationMenuItem({ ...props }) {
            return <NavigationMenuPrimitive.Item {...props} />;
          }
        `
      );
      await radixPackageFixture.write(
        "src/App.tsx",
        `
          import {
            NavigationMenu,
            NavigationMenuItem,
            NavigationMenuList,
          } from "./navigation-menu";
          const ITEMS = [{ label: "Docs" }];
          export function App() {
            return (
              <NavigationMenu>
                <NavigationMenuList>
                  {ITEMS.map((item) => (
                    <NavigationMenuItem key={item.label}>{item.label}</NavigationMenuItem>
                  ))}
                </NavigationMenuList>
              </NavigationMenu>
            );
          }
        `
      );
      await radixUiFixture.write(
        "src/App.tsx",
        `
          import { NavigationMenu as NavigationMenuPrimitive } from "radix-ui";
          function Menu({ children }) {
            return <NavigationMenuPrimitive.Root>{children}</NavigationMenuPrimitive.Root>;
          }
          export function App() {
            return <Menu><span>Docs</span></Menu>;
          }
        `
      );

      const radixPackageGraph = await buildGraph(radixPackageFixture.rootDir);
      const radixUiGraph = await buildGraph(radixUiFixture.rootDir);
      expect(radixPackageGraph.surfaces[0]?.boundaryReasons).toEqual([]);
      expect(radixUiGraph.surfaces[0]?.boundaryReasons).toEqual([]);
      expect((await runNavRule(radixPackageFixture.rootDir)).status).toBe(
        "pass"
      );
      expect((await runNavRule(radixUiFixture.rootDir)).status).toBe("pass");
    } finally {
      await Promise.all([
        radixPackageFixture.cleanup(),
        radixUiFixture.cleanup(),
      ]);
    }
  });

  it("lets a later proven duplicate dominate an earlier advisory pair", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        `
          export function App({ first, second }) {
            return <>
              <nav aria-label={first} />
              <nav aria-label={second} />
              <nav aria-label="Duplicate" />
              <nav aria-label="Duplicate" />
            </>;
          }
        `
      );

      expect((await runNavRule(fixture.rootDir)).status).toBe("fail");
    } finally {
      await fixture.cleanup();
    }
  });

  it("makes a mounted React.Children projection advisory", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        `
          function Wrapper({ children }) {
            return React.Children.only(children);
          }
          export function App() {
            return <><nav aria-label="Main" /><Wrapper><nav aria-label="Utility" /></Wrapper></>;
          }
        `
      );

      expect((await runNavRule(fixture.rootDir)).status).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  });
});
