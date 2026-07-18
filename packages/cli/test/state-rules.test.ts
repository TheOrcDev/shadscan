import { describe, expect, it } from "vitest";
import { asyncActionPendingStateRule } from "../src/rules/async-action-pending-state";
import { emptyStatePresentRule } from "../src/rules/empty-state-present";
import { errorStateRetryPresentRule } from "../src/rules/error-state-retry-present";
import { notFoundRecoveryPresentRule } from "../src/rules/not-found-recovery-present";
import { routeLoadingBoundaryPresentRule } from "../src/rules/route-loading-boundary-present";
import { suspenseFallbackUsefulRule } from "../src/rules/suspense-fallback-useful";
import { toastProviderMountedRule } from "../src/rules/toast-provider-mounted";
import { createRuleFixture, runRule } from "./rule-fixture";

describe("state rules", () => {
  it("requires loading coverage for async Next routes", async () => {
    const fixture = await createRuleFixture({
      next: "16.2.6",
      react: "19.2.4",
    });

    try {
      await fixture.write(
        "app/dashboard/page.tsx",
        "export default async function Page() { const data = await loadData(); return <main>{data}</main>; }"
      );
      expect(
        (await runRule(fixture.rootDir, routeLoadingBoundaryPresentRule)).status
      ).toBe("fail");

      await fixture.write(
        "app/dashboard/loading.tsx",
        "export default function Loading() { return <Skeleton />; }"
      );
      expect(
        (await runRule(fixture.rootDir, routeLoadingBoundaryPresentRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects empty Suspense fallbacks", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        "export function App() { return <Suspense fallback={null}><Dashboard /></Suspense>; }"
      );
      expect(
        (await runRule(fixture.rootDir, suspenseFallbackUsefulRule)).status
      ).toBe("fail");

      await fixture.write(
        "src/App.tsx",
        "export function App() { return <Suspense fallback={false}><Dashboard /></Suspense>; }"
      );
      expect(
        (await runRule(fixture.rootDir, suspenseFallbackUsefulRule)).status
      ).toBe("fail");

      await fixture.write(
        "src/App.tsx",
        "export function App() { return <Suspense fallback={0}><Dashboard /></Suspense>; }"
      );
      expect(
        (await runRule(fixture.rootDir, suspenseFallbackUsefulRule)).status
      ).toBe("fail");

      await fixture.write(
        "src/App.tsx",
        "export function App({ fallback }) { return <Suspense fallback={fallback}><Dashboard /></Suspense>; }"
      );
      expect(
        (await runRule(fixture.rootDir, suspenseFallbackUsefulRule)).status
      ).toBe("advisory");

      await fixture.write(
        "src/App.tsx",
        "export function App() { return <Suspense fallback={<Skeleton />}><Dashboard /></Suspense>; }"
      );
      expect(
        (await runRule(fixture.rootDir, suspenseFallbackUsefulRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("requires empty states for recognizable data collections", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/projects.tsx",
        "export function Projects({ projects }) { return <ul>{projects.map((project) => <li>{project.name}</li>)}</ul>; }"
      );
      expect(
        (await runRule(fixture.rootDir, emptyStatePresentRule)).status
      ).toBe("fail");

      await fixture.write(
        "src/projects.tsx",
        "export function Projects({ projects }) { if (projects.length === 0) return <Empty>No projects yet</Empty>; return <ul>{projects.map((project) => <li>{project.name}</li>)}</ul>; }"
      );
      expect(
        (await runRule(fixture.rootDir, emptyStatePresentRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("requires error states to expose a wired retry control", async () => {
    const fixture = await createRuleFixture({
      next: "16.2.6",
      react: "19.2.4",
    });

    try {
      await fixture.write(
        "app/error.tsx",
        "export default function Error() { return <p>Something went wrong</p>; }"
      );
      expect(
        (await runRule(fixture.rootDir, errorStateRetryPresentRule)).status
      ).toBe("fail");

      await fixture.write(
        "app/error.tsx",
        "export default function Error({ unstable_retry }) { return <Button onClick={() => unstable_retry()}>Try again</Button>; }"
      );
      expect(
        (await runRule(fixture.rootDir, errorStateRetryPresentRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("requires not-found states to expose a recovery path", async () => {
    const fixture = await createRuleFixture({
      next: "16.2.6",
      react: "19.2.4",
    });

    try {
      await fixture.write(
        "app/not-found.tsx",
        "export default function NotFound() { return <h1>Not found</h1>; }"
      );
      expect(
        (await runRule(fixture.rootDir, notFoundRecoveryPresentRule)).status
      ).toBe("fail");

      await fixture.write(
        "app/not-found.tsx",
        'export default function NotFound() { return <><h1>Not found</h1><Link href="/">Go home</Link></>; }'
      );
      expect(
        (await runRule(fixture.rootDir, notFoundRecoveryPresentRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("requires async actions to communicate and guard pending state", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/form.tsx",
        "export function Form() { return <form onSubmit={save}><Button>Save</Button></form>; }"
      );
      expect(
        (await runRule(fixture.rootDir, asyncActionPendingStateRule)).status
      ).toBe("fail");

      await fixture.write(
        "src/form.tsx",
        'export function Form() { const { isPending } = useFormStatus(); return <form action={save}><Button disabled={isPending}>{isPending ? "Saving..." : "Save"}</Button></form>; }'
      );
      expect(
        (await runRule(fixture.rootDir, asyncActionPendingStateRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("requires toast infrastructure to be mounted from the app shell", async () => {
    const fixture = await createRuleFixture({
      next: "16.2.6",
      react: "19.2.4",
      sonner: "2.0.0",
    });

    try {
      await fixture.write(
        "app/layout.tsx",
        "export default function Layout({ children }) { return <html><body>{children}</body></html>; }"
      );
      expect(
        (await runRule(fixture.rootDir, toastProviderMountedRule)).status
      ).toBe("fail");

      await fixture.write(
        "app/layout.tsx",
        'import { Toaster } from "@/components/toaster"; export default function Layout({ children }) { return <html><body>{children}<Toaster /></body></html>; }'
      );
      await fixture.write(
        "components/toaster.tsx",
        'export function Toaster() { return <div aria-live="polite" />; }'
      );
      expect(
        (await runRule(fixture.rootDir, toastProviderMountedRule)).status
      ).toBe("fail");

      await fixture.write(
        "app/layout.tsx",
        'import { Toaster } from "sonner"; export default function Layout({ children }) { return <html><body>{children}<Toaster /></body></html>; }'
      );
      expect(
        (await runRule(fixture.rootDir, toastProviderMountedRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("follows a mounted toaster to Radix umbrella primitives", async () => {
    const fixture = await createRuleFixture({
      next: "16.2.6",
      "radix-ui": "1.6.0",
      react: "19.2.4",
    });

    try {
      await fixture.write(
        "tsconfig.json",
        JSON.stringify({
          compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } },
        })
      );
      await fixture.write(
        "app/layout.tsx",
        'import { Toaster } from "@/components/ui/toaster"; export default function Layout({ children }) { return <html><body>{children}<Toaster /></body></html>; }'
      );
      await fixture.write(
        "components/ui/toaster.tsx",
        'import { ToastProvider, ToastViewport } from "@/components/ui/toast"; export function Toaster() { return <ToastProvider><ToastViewport /></ToastProvider>; }'
      );
      await fixture.write(
        "components/ui/toast.tsx",
        'import { Toast as ToastPrimitives } from "radix-ui"; export const ToastProvider = ToastPrimitives.Provider; export const ToastViewport = ToastPrimitives.Viewport;'
      );

      expect(
        (await runRule(fixture.rootDir, toastProviderMountedRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("accepts direct Radix providers and terminates cyclic wrappers", async () => {
    const directFixture = await createRuleFixture({
      "@radix-ui/react-toast": "1.2.0",
      next: "16.2.6",
      react: "19.2.4",
    });

    try {
      await directFixture.write(
        "app/layout.tsx",
        'import * as Toast from "@radix-ui/react-toast"; export default function Layout({ children }) { return <html><body><Toast.Provider>{children}<Toast.Viewport /></Toast.Provider></body></html>; }'
      );
      expect(
        (await runRule(directFixture.rootDir, toastProviderMountedRule)).status
      ).toBe("pass");
    } finally {
      await directFixture.cleanup();
    }

    const cyclicFixture = await createRuleFixture({
      next: "16.2.6",
      "radix-ui": "1.6.0",
      react: "19.2.4",
    });

    try {
      await cyclicFixture.write(
        "app/layout.tsx",
        'import { Toaster } from "../components/toaster"; export default function Layout() { return <html><body><Toaster /></body></html>; }'
      );
      await cyclicFixture.write(
        "components/toaster.tsx",
        'import { ToastLayer } from "./toast-layer"; export function Toaster() { return <ToastLayer />; } export const ToastRoot = () => null;'
      );
      await cyclicFixture.write(
        "components/toast-layer.tsx",
        'import { ToastRoot } from "./toaster"; export function ToastLayer() { return <ToastRoot />; }'
      );

      expect(
        (await runRule(cyclicFixture.rootDir, toastProviderMountedRule)).status
      ).toBe("fail");
    } finally {
      await cyclicFixture.cleanup();
    }
  });
});
