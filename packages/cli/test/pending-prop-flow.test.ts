import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAudit } from "../src/audit";
import { asyncActionPendingStateRule } from "../src/rules/async-action-pending-state";

const RULE_ID = "async-action-pending-state";
const tempDirs: string[] = [];

const createFixture = async (): Promise<string> => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "shadscan-pending-"));
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

const writeBaseProject = async (rootDir: string): Promise<void> => {
  await writeFixtureFile(
    rootDir,
    "package.json",
    `${JSON.stringify(
      { dependencies: { react: "19.2.4" }, name: "pending-fixture" },
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
};

/** Call site: a mutation whose pending flag is handed to a shared form. */
const CALL_SITE = `import { SetUploadForm } from "@/components/set-upload-form";
import { useMutation } from "@/lib/use-mutation";

export function Home() {
  const createFirstSet = useMutation();

  return (
    <SetUploadForm
      isPending={createFirstSet.isPending}
      onSubmit={(data) => createFirstSet.mutate(data)}
    />
  );
}
`;

const SHARED_FORM = `import { FormSubmitButton } from "@/components/form-submit-button";

export function SetUploadForm({ isPending, onSubmit }) {
  return (
    <form onSubmit={onSubmit}>
      <input name="name" />
      <FormSubmitButton busy={isPending}>Upload</FormSubmitButton>
    </form>
  );
}
`;

const GOOD_BUTTON = `export function FormSubmitButton({ busy, children }) {
  return (
    <button aria-busy={busy} disabled={busy} type="submit">
      {children}
    </button>
  );
}
`;

const getStatus = async (rootDir: string) => {
  const report = await runAudit(rootDir, {
    rules: [asyncActionPendingStateRule],
  });

  return report.findings.find((finding) => finding.id === RULE_ID)?.status;
};

afterEach(async () => {
  for (const tempDir of tempDirs.splice(0)) {
    await rm(tempDir, { force: true, recursive: true });
  }
});

describe("pending state threaded through props", () => {
  // The exact chain from issue #10: call site -> form -> submit button.
  it("passes a two-hop chain that ends in a disabled, busy trigger", async () => {
    const rootDir = await createFixture();
    await writeBaseProject(rootDir);
    await writeFixtureFile(rootDir, "src/routes/index.tsx", CALL_SITE);
    await writeFixtureFile(
      rootDir,
      "src/components/set-upload-form.tsx",
      SHARED_FORM
    );
    await writeFixtureFile(
      rootDir,
      "src/components/form-submit-button.tsx",
      GOOD_BUTTON
    );

    expect(await getStatus(rootDir)).toBe("pass");
  });

  it("follows a renamed prop", async () => {
    const rootDir = await createFixture();
    await writeBaseProject(rootDir);
    await writeFixtureFile(
      rootDir,
      "src/routes/index.tsx",
      `import { Form } from "@/components/form";

export function Home() {
  const isPending = false;

  return <Form onSubmit={() => undefined} pending={isPending} />;
}
`
    );
    await writeFixtureFile(
      rootDir,
      "src/components/form.tsx",
      `export function Form({ pending: awaitingResponse, onSubmit }) {
  return (
    <form onSubmit={onSubmit}>
      <button disabled={awaitingResponse} type="submit">
        {awaitingResponse ? "Saving..." : "Save"}
      </button>
    </form>
  );
}
`
    );

    expect(await getStatus(rootDir)).toBe("pass");
  });

  it("fails when the receiving component never disables the trigger", async () => {
    const rootDir = await createFixture();
    await writeBaseProject(rootDir);
    await writeFixtureFile(rootDir, "src/routes/index.tsx", CALL_SITE);
    await writeFixtureFile(
      rootDir,
      "src/components/set-upload-form.tsx",
      SHARED_FORM
    );
    await writeFixtureFile(
      rootDir,
      "src/components/form-submit-button.tsx",
      `import { Spinner } from "@/components/spinner";

export function FormSubmitButton({ busy, children }) {
  return (
    <button type="submit">
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
}
`
    );

    expect(await getStatus(rootDir)).toBe("fail");
  });

  // A spread hides which prop carries the value, so the rename is untrackable.
  it("fails when props are spread into the receiving component", async () => {
    const rootDir = await createFixture();
    await writeBaseProject(rootDir);
    await writeFixtureFile(
      rootDir,
      "src/routes/index.tsx",
      `import { Form } from "@/components/form";

export function Home() {
  const isPending = false;
  const rest = {};

  return <Form isPending={isPending} onSubmit={() => undefined} {...rest} />;
}
`
    );
    await writeFixtureFile(
      rootDir,
      "src/components/form.tsx",
      `export function Form({ isPending, onSubmit }) {
  return (
    <form onSubmit={onSubmit}>
      <button disabled={isPending} type="submit">
        {isPending ? "Saving..." : "Save"}
      </button>
    </form>
  );
}
`
    );

    expect(await getStatus(rootDir)).toBe("fail");
  });

  it("fails when the chain is longer than the hop budget", async () => {
    const rootDir = await createFixture();
    await writeBaseProject(rootDir);
    await writeFixtureFile(rootDir, "src/routes/index.tsx", CALL_SITE);
    await writeFixtureFile(
      rootDir,
      "src/components/set-upload-form.tsx",
      SHARED_FORM
    );
    await writeFixtureFile(
      rootDir,
      "src/components/form-submit-button.tsx",
      `import { InnerButton } from "@/components/inner-button";

export function FormSubmitButton({ busy, children }) {
  return <InnerButton pending={busy}>{children}</InnerButton>;
}
`
    );
    await writeFixtureFile(
      rootDir,
      "src/components/inner-button.tsx",
      `export function InnerButton({ pending, children }) {
  return (
    <button aria-busy={pending} disabled={pending} type="submit">
      {children}
    </button>
  );
}
`
    );

    expect(await getStatus(rootDir)).toBe("fail");
  });

  it("fails when the receiving component is outside the project", async () => {
    const rootDir = await createFixture();
    await writeBaseProject(rootDir);
    await writeFixtureFile(
      rootDir,
      "src/routes/index.tsx",
      `import { VendorForm } from "some-vendor-forms";

export function Home() {
  const isPending = false;

  return <VendorForm isPending={isPending} onSubmit={() => undefined} />;
}
`
    );

    expect(await getStatus(rootDir)).toBe("fail");
  });

  // A spinner beside an always-enabled button is not duplicate-submit
  // prevention, so half a trigger must not satisfy the rule.
  it("fails when the trigger shows progress but stays enabled", async () => {
    const rootDir = await createFixture();
    await writeBaseProject(rootDir);
    await writeFixtureFile(
      rootDir,
      "src/routes/index.tsx",
      `import { Form } from "@/components/form";

export function Home() {
  const isPending = false;

  return <Form isPending={isPending} onSubmit={() => undefined} />;
}
`
    );
    await writeFixtureFile(
      rootDir,
      "src/components/form.tsx",
      `export function Form({ isPending, onSubmit }) {
  return (
    <form onSubmit={onSubmit}>
      <button type="submit">{isPending ? "Saving..." : "Save"}</button>
    </form>
  );
}
`
    );

    expect(await getStatus(rootDir)).toBe("fail");
  });

  it("keeps passing a single scope that owns the whole trigger", async () => {
    const rootDir = await createFixture();
    await writeBaseProject(rootDir);
    await writeFixtureFile(
      rootDir,
      "src/routes/index.tsx",
      `export function Home() {
  const isPending = false;

  return (
    <form onSubmit={() => undefined}>
      <button aria-busy={isPending} disabled={isPending} type="submit">
        {isPending ? "Saving..." : "Save"}
      </button>
    </form>
  );
}
`
    );

    expect(await getStatus(rootDir)).toBe("pass");
  });
});
