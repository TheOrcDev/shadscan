import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AuditFinding, AuditRule } from "../src/audit";
import { runAudit } from "../src/audit";

interface RuleFixture {
  cleanup: () => Promise<void>;
  rootDir: string;
  write: (filePath: string, content: string) => Promise<void>;
}

const createRuleFixture = async (
  dependencies: Record<string, string> = { react: "19.2.4" }
): Promise<RuleFixture> => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "shadscan-expanded-rule-"));

  const write = async (filePath: string, content: string): Promise<void> => {
    const absolutePath = path.join(rootDir, filePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
  };

  await write(
    "package.json",
    `${JSON.stringify({ dependencies, name: "expanded-rule-fixture" }, null, 2)}\n`
  );

  return {
    cleanup: async () => {
      await rm(rootDir, { force: true, recursive: true });
    },
    rootDir,
    write,
  };
};

const runRule = async (
  rootDir: string,
  rule: AuditRule
): Promise<AuditFinding> => {
  const report = await runAudit(rootDir, { rules: [rule] });
  const finding = report.findings[0];

  if (!finding) {
    throw new Error(`Rule ${rule.id} did not produce a finding.`);
  }

  return finding;
};

export { createRuleFixture, runRule };
