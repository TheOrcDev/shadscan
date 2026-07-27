import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAudit } from "../src/audit";
import { mobileNavPresentRule } from "../src/rules/mobile-nav-present";

const RULE_ID = "mobile-nav-present";
const tempDirs: string[] = [];

const createFixture = async (): Promise<string> => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "shadscan-sidebar-"));
  tempDirs.push(fixtureDir);

  return fixtureDir;
};

const writeFixtureFile = async (
  rootDir: string,
  filePath: string,
  content: string
): Promise<void> => {
  const absolutePath = path.join(rootDir, filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
};

/** The generated shadcn runtime: the mobile Sheet lives here. */
const SIDEBAR_RUNTIME = `import * as React from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";

const SidebarContext = React.createContext(null);

export function useSidebar() {
  return React.useContext(SidebarContext);
}

export function SidebarProvider({ children }) {
  const isMobile = useIsMobile();
  const [openMobile, setOpenMobile] = React.useState(false);
  const toggleSidebar = () => setOpenMobile((open) => !open);
  return (
    <SidebarContext.Provider
      value={{ isMobile, openMobile, setOpenMobile, toggleSidebar }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

export function Sidebar({ children }) {
  const { isMobile, openMobile, setOpenMobile } = useSidebar();

  if (isMobile) {
    return (
      <Sheet onOpenChange={setOpenMobile} open={openMobile}>
        <SheetContent side="left">{children}</SheetContent>
      </Sheet>
    );
  }

  return <div className="hidden md:block">{children}</div>;
}

export function SidebarTrigger() {
  const { toggleSidebar } = useSidebar();
  return <button aria-label="Toggle Sidebar" onClick={toggleSidebar} type="button">Menu</button>;
}
`;

const APP_SIDEBAR = `import { Sidebar } from "@/components/ui/sidebar";

export function AppSidebar() {
  return (
    <Sidebar>
      <nav>
        <a href="/">Dashboard</a>
        <a href="/settings">Settings</a>
      </nav>
    </Sidebar>
  );
}
`;

const writeBaseProject = async (rootDir: string): Promise<void> => {
  await writeFixtureFile(
    rootDir,
    "package.json",
    `${JSON.stringify(
      { dependencies: { react: "19.2.4" }, name: "sidebar-fixture" },
      null,
      2
    )}\n`
  );
  await writeFixtureFile(
    rootDir,
    "tsconfig.json",
    `${JSON.stringify(
      {
        compilerOptions: {
          baseUrl: ".",
          jsx: "react-jsx",
          paths: { "@/*": ["./src/*"] },
        },
      },
      null,
      2
    )}\n`
  );
  await writeFixtureFile(
    rootDir,
    "src/components/ui/sidebar.tsx",
    SIDEBAR_RUNTIME
  );
};

const getStatus = async (rootDir: string) => {
  const report = await runAudit(rootDir, { rules: [mobileNavPresentRule] });

  return report.findings.find((finding) => finding.id === RULE_ID)?.status;
};

afterEach(async () => {
  for (const tempDir of tempDirs.splice(0)) {
    await rm(tempDir, { force: true, recursive: true });
  }
});

describe("shadcn sidebar mobile navigation", () => {
  // The layout `shadcn add sidebar` nudges you toward: provider in the
  // layout, <Sidebar> in its own module. This is the issue-10 regression.
  it("passes when the provider and the sidebar live in separate files", async () => {
    const rootDir = await createFixture();
    await writeBaseProject(rootDir);
    await writeFixtureFile(
      rootDir,
      "src/components/app-sidebar.tsx",
      APP_SIDEBAR
    );
    await writeFixtureFile(
      rootDir,
      "src/app/layout.tsx",
      `import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export default function Layout({ children }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <main>
        <SidebarTrigger />
        {children}
      </main>
    </SidebarProvider>
  );
}
`
    );

    expect(await getStatus(rootDir)).toBe("pass");
  });

  it("still passes when one file holds the whole composition", async () => {
    const rootDir = await createFixture();
    await writeBaseProject(rootDir);
    await writeFixtureFile(
      rootDir,
      "src/app/layout.tsx",
      `import {
  Sidebar,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

export default function Layout({ children }) {
  return (
    <SidebarProvider>
      <Sidebar>
        <a href="/">Dashboard</a>
      </Sidebar>
      <main>
        <SidebarTrigger />
        {children}
      </main>
    </SidebarProvider>
  );
}
`
    );

    expect(await getStatus(rootDir)).toBe("pass");
  });

  it("passes when the trigger lives in a third file", async () => {
    const rootDir = await createFixture();
    await writeBaseProject(rootDir);
    await writeFixtureFile(
      rootDir,
      "src/components/app-sidebar.tsx",
      APP_SIDEBAR
    );
    await writeFixtureFile(
      rootDir,
      "src/components/site-header.tsx",
      `import { SidebarTrigger } from "@/components/ui/sidebar";

export function SiteHeader() {
  return (
    <header>
      <SidebarTrigger />
    </header>
  );
}
`
    );
    await writeFixtureFile(
      rootDir,
      "src/app/layout.tsx",
      `import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarProvider } from "@/components/ui/sidebar";

export default function Layout({ children }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <main>
        <SiteHeader />
        {children}
      </main>
    </SidebarProvider>
  );
}
`
    );

    expect(await getStatus(rootDir)).toBe("pass");
  });

  // Real sidebars delegate their links to a nav sub-component, so the link
  // is one hop below <Sidebar> rather than in the same file.
  it("passes when the sidebar delegates its links to a nav component", async () => {
    const rootDir = await createFixture();
    await writeBaseProject(rootDir);
    await writeFixtureFile(
      rootDir,
      "src/components/nav-group.tsx",
      `export function NavGroup({ items }) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item.title}>
          <a href={item.url}>{item.title}</a>
        </li>
      ))}
    </ul>
  );
}
`
    );
    await writeFixtureFile(
      rootDir,
      "src/components/app-sidebar.tsx",
      `import { NavGroup } from "@/components/nav-group";
import { Sidebar } from "@/components/ui/sidebar";

export function AppSidebar() {
  return (
    <Sidebar>
      <NavGroup items={[]} />
    </Sidebar>
  );
}
`
    );
    await writeFixtureFile(
      rootDir,
      "src/app/layout.tsx",
      `import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export default function Layout({ children }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <main>
        <SidebarTrigger />
        {children}
      </main>
    </SidebarProvider>
  );
}
`
    );

    expect(await getStatus(rootDir)).toBe("pass");
  });

  // An empty shell is not navigation, however it is mounted.
  it("fails when the sidebar contains no links at any hop", async () => {
    const rootDir = await createFixture();
    await writeBaseProject(rootDir);
    await writeFixtureFile(
      rootDir,
      "src/components/app-sidebar.tsx",
      `import { Sidebar } from "@/components/ui/sidebar";

export function AppSidebar() {
  return (
    <Sidebar>
      <p>No navigation here</p>
    </Sidebar>
  );
}
`
    );
    await writeFixtureFile(
      rootDir,
      "src/app/layout.tsx",
      `import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export default function Layout({ children }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <main>
        <SidebarTrigger />
        {children}
      </main>
    </SidebarProvider>
  );
}
`
    );

    expect(await getStatus(rootDir)).toBe("fail");
  });

  // The false-pass guard: both halves exist, but nothing mounts the sidebar.
  it("fails when the sidebar module is never rendered by the provider", async () => {
    const rootDir = await createFixture();
    await writeBaseProject(rootDir);
    await writeFixtureFile(
      rootDir,
      "src/components/app-sidebar.tsx",
      APP_SIDEBAR
    );
    await writeFixtureFile(
      rootDir,
      "src/app/layout.tsx",
      `import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export default function Layout({ children }) {
  return (
    <SidebarProvider>
      <main>
        <SidebarTrigger />
        {children}
      </main>
    </SidebarProvider>
  );
}
`
    );

    expect(await getStatus(rootDir)).toBe("fail");
  });

  it("fails when the sidebar is composed but no trigger exists", async () => {
    const rootDir = await createFixture();
    await writeBaseProject(rootDir);
    await writeFixtureFile(
      rootDir,
      "src/components/app-sidebar.tsx",
      APP_SIDEBAR
    );
    await writeFixtureFile(
      rootDir,
      "src/app/layout.tsx",
      `import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";

export default function Layout({ children }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <main>{children}</main>
    </SidebarProvider>
  );
}
`
    );

    expect(await getStatus(rootDir)).toBe("fail");
  });

  // Rendering the sidebar outside the provider does not make it a panel.
  it("fails when the sidebar is rendered outside the provider", async () => {
    const rootDir = await createFixture();
    await writeBaseProject(rootDir);
    await writeFixtureFile(
      rootDir,
      "src/components/app-sidebar.tsx",
      APP_SIDEBAR
    );
    await writeFixtureFile(
      rootDir,
      "src/app/layout.tsx",
      `import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export default function Layout({ children }) {
  return (
    <div>
      <AppSidebar />
      <SidebarProvider>
        <main>
          <SidebarTrigger />
          {children}
        </main>
      </SidebarProvider>
    </div>
  );
}
`
    );

    expect(await getStatus(rootDir)).toBe("fail");
  });
});
