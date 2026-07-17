import { describe, expect, it } from "vitest";
import { emptyStatePresentRule } from "../src/rules/empty-state-present";
import { errorStateRetryPresentRule } from "../src/rules/error-state-retry-present";
import { notFoundRecoveryPresentRule } from "../src/rules/not-found-recovery-present";
import { routeLoadingBoundaryPresentRule } from "../src/rules/route-loading-boundary-present";
import { suspenseFallbackUsefulRule } from "../src/rules/suspense-fallback-useful";
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
});
