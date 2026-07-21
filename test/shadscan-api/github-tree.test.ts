import { describe, expect, it } from "vitest";
import {
  classifyGitHubProjectPath,
  discoverGitHubProjectCandidates,
  type GitHubTreeEntry,
  getRetainedGitHubTreeEntries,
  normalizeGitHubTreeEntries,
} from "../../lib/shadscan-api/github-tree";

const SHA = "0123456789abcdef0123456789abcdef01234567";

const blob = (
  filePath: string,
  size = 10,
  mode = "100644"
): GitHubTreeEntry => ({
  mode,
  path: filePath,
  sha: SHA,
  size,
  type: "blob",
});

describe("GitHub tree project discovery", () => {
  it("prefers a root app and does not mistake nested package files for root signals", () => {
    const candidates = discoverGitHubProjectCandidates([
      blob("package.json"),
      blob("app/page.tsx"),
      blob("apps/admin/package.json"),
      blob("apps/admin/src/App.tsx"),
    ]);

    expect(candidates).toEqual([
      { label: "Repository root", path: "." },
      { label: "apps/admin", path: "apps/admin" },
    ]);
  });

  it("finds one nested React package in a workspace root", () => {
    expect(
      discoverGitHubProjectCandidates([
        blob("package.json"),
        blob("pnpm-workspace.yaml"),
        blob("apps/web/package.json"),
        blob("apps/web/src/main.tsx"),
      ])
    ).toEqual([{ label: "apps/web", path: "apps/web" }]);
  });

  it("normalizes ordering and rejects duplicate or unsafe paths", () => {
    expect(
      normalizeGitHubTreeEntries([blob("src/App.tsx"), blob("package.json")])
    ).toEqual([blob("package.json"), blob("src/App.tsx")]);
    expect(() =>
      normalizeGitHubTreeEntries([blob("package.json"), blob("package.json")])
    ).toThrow(expect.objectContaining({ code: "ARCHIVE_DUPLICATE_PATH" }));
    expect(() => normalizeGitHubTreeEntries([blob("../secret")])).toThrow(
      expect.objectContaining({ code: "UNSAFE_ARCHIVE_PATH" })
    );
  });

  it("retains one selected subtree plus ancestor workspace metadata", () => {
    const entries = [
      blob("package.json"),
      blob("pnpm-lock.yaml"),
      blob("apps/admin/package.json"),
      blob("apps/admin/src/App.tsx"),
      blob("apps/admin/public/favicon.ico", 500),
      blob("apps/admin/public/demo.png", 500),
      blob("apps/store/package.json"),
      blob("apps/store/src/App.tsx"),
    ];

    expect(
      getRetainedGitHubTreeEntries(entries, "apps/admin").map(
        ({ path, retention }) => ({ path, retention })
      )
    ).toEqual([
      { path: "package.json", retention: "content" },
      { path: "pnpm-lock.yaml", retention: "content" },
      { path: "apps/admin/package.json", retention: "content" },
      { path: "apps/admin/src/App.tsx", retention: "content" },
      { path: "apps/admin/public/favicon.ico", retention: "presence" },
    ]);
    expect(
      classifyGitHubProjectPath("apps/store/src/App.tsx", "apps/admin")
    ).toBe("ignore");
  });

  it("rejects a retained symlink or submodule without rejecting unrelated ones", () => {
    const entries = [
      blob("apps/admin/package.json"),
      blob("apps/admin/src/App.tsx", 10, "120000"),
      blob("apps/store/link.tsx", 10, "120000"),
    ];

    expect(() => getRetainedGitHubTreeEntries(entries, "apps/admin")).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_ARCHIVE_ENTRY" })
    );
    expect(() => getRetainedGitHubTreeEntries(entries, "apps/store")).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_ARCHIVE_ENTRY" })
    );
    expect(getRetainedGitHubTreeEntries(entries, "other")).toEqual([]);
  });
});
