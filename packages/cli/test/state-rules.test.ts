import { describe, expect, it } from "vitest";
import { routeLoadingBoundaryPresentRule } from "../src/rules/route-loading-boundary-present";
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
});
