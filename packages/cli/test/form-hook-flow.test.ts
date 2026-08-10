import { describe, expect, it } from "vitest";
import { fieldErrorsRenderedRule } from "../src/rules/field-errors-rendered";
import { validationWiredToFormRule } from "../src/rules/validation-wired-to-form";
import { createRuleFixture, runRule } from "./rule-fixture";

describe("form hook flow", () => {
  it("connects validation and rendered errors across a custom form hook", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
      zod: "4.0.17",
    });

    try {
      await fixture.write(
        "tsconfig.json",
        JSON.stringify({
          compilerOptions: {
            baseUrl: ".",
            paths: { "@/*": ["./src/*"] },
          },
        })
      );
      await fixture.write(
        "src/hooks/use-editor.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";
          import { z } from "zod";

          const schema = z.object({ email: z.email() });

          export function useEditor() {
            const form = useForm({ resolver: zodResolver(schema) });
            return form;
          }
        `
      );
      await fixture.write(
        "src/app/page.tsx",
        `
          import { useEditor } from "@/hooks/use-editor";

          export default function Page() {
            const form = useEditor();
            return (
              <form onSubmit={form.handleSubmit(save)}>
                <Input {...form.register("email")} />
                {form.formState.errors.email && (
                  <FieldError>{form.formState.errors.email.message}</FieldError>
                )}
              </form>
            );
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("pass");
      expect(
        (await runRule(fixture.rootDir, fieldErrorsRenderedRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("connects a same-file custom form hook to its consumer", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
      zod: "4.0.17",
    });

    try {
      await fixture.write(
        "src/page.tsx",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          function useEditor() {
            const form = useForm({ resolver: zodResolver(schema) });
            return form;
          }

          export function Page() {
            const form = useEditor();
            return (
              <form onSubmit={form.handleSubmit(save)}>
                <Input {...form.register("email")} />
                {form.formState.errors.email && (
                  <FieldError>{form.formState.errors.email.message}</FieldError>
                )}
              </form>
            );
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("pass");
      expect(
        (await runRule(fixture.rootDir, fieldErrorsRenderedRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("requires error UI in a consumer of a validated form hook", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/hooks/use-editor.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          export function useEditor() {
            const form = useForm({ resolver: zodResolver(schema) });
            return form;
          }
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { useEditor } from "./hooks/use-editor";

          export function Page() {
            const form = useEditor();
            return (
              <form onSubmit={form.handleSubmit(save)}>
                <Input {...form.register("email")} />
              </form>
            );
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("pass");

      const fieldErrors = await runRule(
        fixture.rootDir,
        fieldErrorsRenderedRule
      );
      expect(fieldErrors.status).toBe("fail");
      expect(fieldErrors.evidence[0]?.filePath).toContain("src/page.tsx");
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not invent validation for a plain useForm provider", async () => {
    const fixture = await createRuleFixture({
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/hooks/use-editor.ts",
        `
          import { useForm } from "react-hook-form";

          export function useEditor() {
            const form = useForm();
            return form;
          }
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { useEditor } from "./hooks/use-editor";

          export function Page() {
            const form = useEditor();
            return (
              <form onSubmit={form.handleSubmit(save)}>
                <Input {...form.register("email")} />
                {form.formState.errors.email && (
                  <FieldError>{form.formState.errors.email.message}</FieldError>
                )}
              </form>
            );
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("fail");
      expect(
        (await runRule(fixture.rootDir, fieldErrorsRenderedRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not borrow evidence from an unrelated validated hook", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/hooks.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          export function useValidatedForm() {
            const form = useForm({ resolver: zodResolver(schema) });
            return form;
          }

          export function usePlainForm() {
            const form = useForm();
            return form;
          }
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { usePlainForm, useValidatedForm } from "./hooks";

          export function Page() {
            const form = usePlainForm();
            const unrelated = useValidatedForm();
            return (
              <form onSubmit={form.handleSubmit(save)}>
                <Input {...form.register("email")} />
                {form.formState.errors.email && (
                  <FieldError>{form.formState.errors.email.message}</FieldError>
                )}
              </form>
            );
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("fail");
      expect(
        (await runRule(fixture.rootDir, fieldErrorsRenderedRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("checks every consumer of a shared validated hook", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/use-editor.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          export function useEditor() {
            const form = useForm({ resolver: zodResolver(schema) });
            return form;
          }
        `
      );
      await fixture.write(
        "src/complete.tsx",
        `
          import { useEditor } from "./use-editor";

          export function CompleteForm() {
            const form = useEditor();
            return <form onSubmit={form.handleSubmit(save)}>
              {form.formState.errors.email && <FieldError />}
            </form>;
          }
        `
      );
      await fixture.write(
        "src/incomplete.tsx",
        `
          import { useEditor } from "./use-editor";

          export function IncompleteForm() {
            const form = useEditor();
            return <form onSubmit={form.handleSubmit(save)}><Input /></form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("pass");

      const fieldErrors = await runRule(
        fixture.rootDir,
        fieldErrorsRenderedRule
      );
      expect(fieldErrors.status).toBe("fail");
      expect(fieldErrors.evidence[0]?.filePath).toContain("incomplete.tsx");
    } finally {
      await fixture.cleanup();
    }
  });

  it("follows an aliased named hook import", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/use-editor.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          export function useEditor() {
            const form = useForm({ resolver: zodResolver(schema) });
            return form;
          }
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { useEditor as useEditorForm } from "./use-editor";

          export function Page() {
            const editor = useEditorForm();
            return <form onSubmit={editor.handleSubmit(save)}>
              {editor.formState.errors.email && <FieldError />}
            </form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("pass");
      expect(
        (await runRule(fixture.rootDir, fieldErrorsRenderedRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("follows a direct-return arrow hook with an aliased useForm import", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/use-editor.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm as useHookForm } from "react-hook-form";

          export const useEditor = () =>
            useHookForm({ resolver: zodResolver(schema) });
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { useEditor } from "./use-editor";

          export function Page() {
            const form = useEditor();
            return <form onSubmit={form.handleSubmit(save)}>
              {form.formState.errors.email && <FieldError />}
            </form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("pass");
      expect(
        (await runRule(fixture.rootDir, fieldErrorsRenderedRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("follows a default-exported form hook", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/use-editor.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          export default function useEditor() {
            const form = useForm({ resolver: zodResolver(schema) });
            return form;
          }
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import useEditorForm from "./use-editor";

          export function Page() {
            const form = useEditorForm();
            return <form onSubmit={form.handleSubmit(save)}>
              {form.formState.errors.email && <FieldError />}
            </form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("pass");
      expect(
        (await runRule(fixture.rootDir, fieldErrorsRenderedRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("follows destructured React Hook Form members", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/use-editor.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          export function useEditor() {
            const form = useForm({ resolver: zodResolver(schema) });
            return form;
          }
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { useEditor } from "./use-editor";

          export function Page() {
            const {
              register,
              handleSubmit,
              formState: { errors },
            } = useEditor();
            return <form onSubmit={handleSubmit(save)}>
              <Input {...register("email")} />
              {errors.email && <FieldError />}
            </form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("pass");
      expect(
        (await runRule(fixture.rootDir, fieldErrorsRenderedRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("follows a form instance returned inside an object", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/use-editor.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          export function useEditor() {
            const form = useForm({ resolver: zodResolver(schema) });
            return { form };
          }
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { useEditor } from "./use-editor";

          export function Page() {
            const { form } = useEditor();
            return <form onSubmit={form.handleSubmit(save)}>
              {form.formState.errors.email && <FieldError />}
            </form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("pass");
      expect(
        (await runRule(fixture.rootDir, fieldErrorsRenderedRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("follows a form instance spread into the returned object", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/use-editor.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          export function useEditor() {
            const form = useForm({ resolver: zodResolver(schema) });
            return { ...form };
          }
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { useEditor } from "./use-editor";

          export function Page() {
            const form = useEditor();
            return <form onSubmit={form.handleSubmit(save)}>
              {form.formState.errors.email && <FieldError />}
            </form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("pass");
      expect(
        (await runRule(fixture.rootDir, fieldErrorsRenderedRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("follows a validated form through two custom-hook hops", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/use-editor.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          function useValidatedForm() {
            return useForm({ resolver: zodResolver(schema) });
          }

          export function useEditor() {
            const form = useValidatedForm();
            return form;
          }
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { useEditor } from "./use-editor";

          export function Page() {
            const form = useEditor();
            return <form onSubmit={form.handleSubmit(save)}>
              {form.formState.errors.email && <FieldError />}
            </form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("pass");
      expect(
        (await runRule(fixture.rootDir, fieldErrorsRenderedRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("reports dynamic custom-hook returns as advisory", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/use-editor.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          function useValidatedForm() {
            return useForm({ resolver: zodResolver(schema) });
          }

          function usePlainForm() {
            return useForm();
          }

          export function useEditor() {
            return enabled ? useValidatedForm() : usePlainForm();
          }
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { useEditor } from "./use-editor";

          export function Page() {
            const form = useEditor();
            return <form onSubmit={form.handleSubmit(save)}><Input /></form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("advisory");
      expect(
        (await runRule(fixture.rootDir, fieldErrorsRenderedRule)).status
      ).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  });

  it("terminates cyclic custom-hook flow as advisory", async () => {
    const fixture = await createRuleFixture({ react: "19.2.4" });

    try {
      await fixture.write(
        "src/use-editor.ts",
        `
          export function useEditor() {
            return useEditorBase();
          }

          function useEditorBase() {
            return useEditor();
          }
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { useEditor } from "./use-editor";

          export function Page() {
            const form = useEditor();
            return <form onSubmit={form.handleSubmit(save)}><Input /></form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("advisory");
      expect(
        (await runRule(fixture.rootDir, fieldErrorsRenderedRule)).status
      ).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  });

  it("reports dynamic useForm options as uncertain validation", async () => {
    const fixture = await createRuleFixture({
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/use-editor.ts",
        `
          import { useForm } from "react-hook-form";

          export function useEditor(options) {
            const form = useForm(options);
            return form;
          }
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { useEditor } from "./use-editor";

          export function Page() {
            const form = useEditor(formOptions);
            return <form onSubmit={form.handleSubmit(save)}>
              {form.formState.errors.email && <FieldError />}
            </form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("advisory");
      expect(
        (await runRule(fixture.rootDir, fieldErrorsRenderedRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps a direct unvalidated useForm call as a definite failure", async () => {
    const fixture = await createRuleFixture({
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/page.tsx",
        `
          import { useForm } from "react-hook-form";

          export function Page() {
            const form = useForm();
            return <form onSubmit={form.handleSubmit(save)}><Input /></form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("fail");
      expect(
        (await runRule(fixture.rootDir, fieldErrorsRenderedRule)).status
      ).toBe("fail");
    } finally {
      await fixture.cleanup();
    }
  });

  it("reports namespace hook calls as advisory instead of guessing", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/use-editor.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          export function useEditor() {
            return useForm({ resolver: zodResolver(schema) });
          }
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import * as editorHooks from "./use-editor";

          export function Page() {
            const form = editorHooks.useEditor();
            return <form onSubmit={form.handleSubmit(save)}><Input /></form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("advisory");
      expect(
        (await runRule(fixture.rootDir, fieldErrorsRenderedRule)).status
      ).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  });

  it("stops wrapper-hook traversal at its bounded depth", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/use-editor.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          function useBaseForm() {
            return useForm({ resolver: zodResolver(schema) });
          }
          function useLevelThree() { return useBaseForm(); }
          function useLevelTwo() { return useLevelThree(); }
          function useLevelOne() { return useLevelTwo(); }
          export function useEditor() { return useLevelOne(); }
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { useEditor } from "./use-editor";

          export function Page() {
            const form = useEditor();
            return <form onSubmit={form.handleSubmit(save)}><Input /></form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("advisory");
      expect(
        (await runRule(fixture.rootDir, fieldErrorsRenderedRule)).status
      ).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  });

  it("reports an advisory when a form exceeds the hook-call budget", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });
    const hookCount = 17;
    const hookDefinitions = Array.from(
      { length: hookCount },
      (_, index) => `
        function useForm${index}() {
          return useForm({ resolver: zodResolver(schema) });
        }
      `
    ).join("\n");
    const hookCalls = Array.from(
      { length: hookCount },
      (_, index) => `const form${index} = useForm${index}();`
    ).join("\n");
    const registeredInputs = Array.from(
      { length: hookCount },
      (_, index) => `<Input {...form${index}.register("field${index}")} />`
    ).join("\n");

    try {
      await fixture.write(
        "src/page.tsx",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          ${hookDefinitions}

          export function Page() {
            ${hookCalls}
            return <form onSubmit={form0.handleSubmit(save)}>
              ${registeredInputs}
              <FieldError />
            </form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("advisory");
      expect(
        (await runRule(fixture.rootDir, fieldErrorsRenderedRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("connects a hook result spread into a Form component", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/use-editor.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          export function useEditor() {
            return useForm({ resolver: zodResolver(schema) });
          }
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { useEditor } from "./use-editor";

          export function Page() {
            const form = useEditor();
            return (
              <Form {...form}>
                <form><FieldError /></form>
              </Form>
            );
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("pass");
      expect(
        (await runRule(fixture.rootDir, fieldErrorsRenderedRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not treat an unconsumed provider hook as error UI", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/use-editor.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          export function useEditor() {
            return useForm({ resolver: zodResolver(schema) });
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, fieldErrorsRenderedRule)).status
      ).toBe("not-applicable");
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not borrow hook flow from a nested function", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/page.tsx",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          function useValidatedForm() {
            return useForm({ resolver: zodResolver(schema) });
          }

          export function Page() {
            const makeSubmit = () => {
              const nestedForm = useValidatedForm();
              return nestedForm.handleSubmit(save);
            };
            return <form><Input /></form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("fail");
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not resolve through an imported hook shadowed by a local binding", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/imported-hook.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          export function useEditor() {
            return useForm({ resolver: zodResolver(schema) });
          }
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { useForm } from "react-hook-form";
          import { useEditor } from "./imported-hook";

          export function Page() {
            const useEditor = () => useForm();
            const form = useEditor();
            return <form onSubmit={form.handleSubmit(save)}><Input /></form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not resolve through an imported hook shadowed later in its owner", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/imported-hook.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          export function useEditor() {
            return useForm({ resolver: zodResolver(schema) });
          }
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { useForm } from "react-hook-form";
          import { useEditor } from "./imported-hook";

          export function Page() {
            const form = useEditor();
            function useEditor() {
              return useForm();
            }
            return <form onSubmit={form.handleSubmit(save)}><Input /></form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not resolve through an import shadowed by a destructured parameter", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/imported-hook.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          export function useEditor() {
            return useForm({ resolver: zodResolver(schema) });
          }
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { useEditor } from "./imported-hook";

          export function Page({ useEditor }) {
            const form = useEditor();
            return <form onSubmit={form.handleSubmit(save)}><Input /></form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not judge a linked provider that also returns metadata as UI", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/use-editor.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          export function useEditor() {
            const form = useForm({ resolver: zodResolver(schema) });
            return { form, status: "ready" };
          }
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { useEditor } from "./use-editor";

          export function Page() {
            const { form } = useEditor();
            return (
              <form onSubmit={form.handleSubmit(save)}>
                <Input {...form.register("email")} />
                <FieldError>{form.formState.errors.email?.message}</FieldError>
              </form>
            );
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("pass");
      expect(
        (await runRule(fixture.rootDir, fieldErrorsRenderedRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("treats shadowed provider aliases as ambiguous", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/use-editor.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          export function useEditor() {
            const form = useForm();
            {
              const form = useForm({ resolver: zodResolver(schema) });
              void form;
            }
            return form;
          }
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { useEditor } from "./use-editor";

          export function Page() {
            const form = useEditor();
            return <form onSubmit={form.handleSubmit(save)}><Input /></form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  });

  it("reports a barrel-reexported custom hook as advisory", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/hooks/use-editor.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          export function useEditor() {
            return useForm({ resolver: zodResolver(schema) });
          }
        `
      );
      await fixture.write(
        "src/hooks/index.ts",
        `export { useEditor } from "./use-editor";`
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { useEditor } from "./hooks";

          export function Page() {
            const form = useEditor();
            return <form onSubmit={form.handleSubmit(save)}><Input /></form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("advisory");
      expect(
        (await runRule(fixture.rootDir, fieldErrorsRenderedRule)).status
      ).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not treat a shadowed useForm call as React Hook Form", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/use-editor.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          export function useEditor(useForm) {
            return useForm({ resolver: zodResolver(schema) });
          }
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { useEditor } from "./use-editor";

          export function Page() {
            const form = useEditor();
            return <form onSubmit={form.handleSubmit(save)}><Input /></form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  });

  it("reports an external custom form hook as advisory", async () => {
    const fixture = await createRuleFixture({
      "@acme/forms": "1.0.0",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/page.tsx",
        `
          import { useRemoteForm } from "@acme/forms";

          export function Page() {
            const form = useRemoteForm();
            return <form onSubmit={form.handleSubmit(save)}><Input /></form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("advisory");
      expect(
        (await runRule(fixture.rootDir, fieldErrorsRenderedRule)).status
      ).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not resolve through an import shadowed by local destructuring", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/imported-hook.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          export function useEditor() {
            return useForm({ resolver: zodResolver(schema) });
          }
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { useEditor } from "./imported-hook";

          export function Page(props) {
            const { useEditor } = props;
            const form = useEditor();
            return <form onSubmit={form.handleSubmit(save)}><Input /></form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  });

  it("treats a missing selected property on any return branch as ambiguous", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/use-editor.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          export function useEditor(enabled) {
            const form = useForm({ resolver: zodResolver(schema) });
            if (enabled) {
              return { form };
            }
            return { status: "off" };
          }
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { useEditor } from "./use-editor";

          export function Page() {
            const { form } = useEditor(enabled);
            return <form onSubmit={form.handleSubmit(save)}><Input /></form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  });

  it("treats reassigned provider aliases as ambiguous", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/use-editor.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          export function useEditor() {
            let form = useForm({ resolver: zodResolver(schema) });
            form = useForm();
            return form;
          }
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { useEditor } from "./use-editor";

          export function Page() {
            const form = useEditor();
            return <form onSubmit={form.handleSubmit(save)}><Input /></form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  });

  it("prefers a component-local shadow over a same-file hook", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/page.tsx",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          function useEditor() {
            return useForm({ resolver: zodResolver(schema) });
          }

          export function Page() {
            function useEditor() {
              return useForm();
            }
            const form = useEditor();
            return <form onSubmit={form.handleSubmit(save)}><Input /></form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not judge an unconsumed object-returning provider as UI", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/use-editor.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          export function useEditor() {
            const form = useForm({ resolver: zodResolver(schema) });
            return { form, status: "ready" };
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, fieldErrorsRenderedRule)).status
      ).toBe("not-applicable");
    } finally {
      await fixture.cleanup();
    }
  });

  it("bounds provider alias traversal", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });
    const aliases = Array.from(
      { length: 40 },
      (_, index) => `const form${index + 1} = form${index};`
    ).join("\n");

    try {
      await fixture.write(
        "src/use-editor.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          export function useEditor() {
            const form0 = useForm({ resolver: zodResolver(schema) });
            ${aliases}
            return form40;
          }
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { useEditor } from "./use-editor";

          export function Page() {
            const form = useEditor();
            return <form onSubmit={form.handleSubmit(save)}><Input /></form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps many form owners in one file within a bounded scan time", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });
    const consumers = Array.from(
      { length: 1000 },
      (_, index) => `
          export function Editor${index}() {
            const form = useEditor();
            return <form onSubmit={form.handleSubmit(save)}><Input /></form>;
          }
        `
    ).join("\n");

    try {
      await fixture.write(
        "src/use-editor.ts",
        `
            import { zodResolver } from "@hookform/resolvers/zod";
            import { useForm } from "react-hook-form";

            export function useEditor() {
              return useForm({ resolver: zodResolver(schema) });
            }
          `
      );
      await fixture.write(
        "src/page.tsx",
        `
            import { useEditor } from "./use-editor";
            ${consumers}
          `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  }, 5000);

  it("keeps many hook bindings in one form owner within a bounded scan time", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });
    const bindings = Array.from(
      { length: 5000 },
      (_, index) => `const form${index} = useEditor();`
    ).join("\n");
    const uses = Array.from(
      { length: 5000 },
      (_, index) => `void form${index}.register;`
    ).join("\n");

    try {
      await fixture.write(
        "src/use-editor.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          export function useEditor() {
            return useForm({ resolver: zodResolver(schema) });
          }
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { useEditor } from "./use-editor";

          export function Page() {
            ${bindings}
            ${uses}
            return <form onSubmit={form0.handleSubmit(save)}><Input /></form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  }, 5000);

  it("keeps repeated provider useForm calls within a bounded scan time", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });
    const calls = Array.from({ length: 5000 }, () => "void useForm();").join(
      "\n"
    );

    try {
      await fixture.write(
        "src/use-editor.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          export function useEditor() {
            ${calls}
            return useForm({ resolver: zodResolver(schema) });
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, fieldErrorsRenderedRule)).status
      ).toBe("not-applicable");
    } finally {
      await fixture.cleanup();
    }
  }, 5000);

  it("does not judge a namespace-based React Hook Form provider as UI", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/use-editor.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import * as RHF from "react-hook-form";

          export function useEditor() {
            return RHF.useForm({ resolver: zodResolver(schema) });
          }
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { useEditor } from "./use-editor";

          export function Page() {
            const form = useEditor();
            return (
              <form onSubmit={form.handleSubmit(save)}>
                <Input {...form.register("email")} />
                <FieldError>{form.formState.errors.email?.message}</FieldError>
              </form>
            );
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("advisory");
      expect(
        (await runRule(fixture.rootDir, fieldErrorsRenderedRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("follows a form property through an object-valued consumer binding", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/use-editor.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          export function useEditor() {
            const form = useForm({ resolver: zodResolver(schema) });
            return { form };
          }
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { useEditor } from "./use-editor";

          export function Page() {
            const editor = useEditor();
            return (
              <form onSubmit={editor.form.handleSubmit(save)}>
                <Input {...editor.form.register("email")} />
                <FieldError>{editor.form.formState.errors.email?.message}</FieldError>
              </form>
            );
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("pass");
      expect(
        (await runRule(fixture.rootDir, fieldErrorsRenderedRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not prove validation from a shorthand resolver value", async () => {
    const fixture = await createRuleFixture({
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/use-editor.ts",
        `
          import { useForm } from "react-hook-form";

          export function useEditor(resolver) {
            return useForm({ resolver });
          }
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { useEditor } from "./use-editor";

          export function Page() {
            const form = useEditor(undefined);
            return <form onSubmit={form.handleSubmit(save)}><Input /></form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not follow a private hook hidden by a re-export collision", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/plain.ts",
        `
          import { useForm } from "react-hook-form";

          export function usePlain() {
            return useForm();
          }
        `
      );
      await fixture.write(
        "src/hooks.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          function useEditor() {
            return useForm({ resolver: zodResolver(schema) });
          }

          export { usePlain as useEditor } from "./plain";
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { useEditor } from "./hooks";

          export function Page() {
            const form = useEditor();
            return <form onSubmit={form.handleSubmit(save)}><Input /></form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not prove validation from an unknown resolver factory", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/use-editor.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          function maybeResolver() {
            return enabled ? zodResolver(schema) : undefined;
          }

          export function useEditor() {
            return useForm({ resolver: maybeResolver() });
          }
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { useEditor } from "./use-editor";

          export function Page() {
            const form = useEditor();
            return <form onSubmit={form.handleSubmit(save)}><Input /></form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  });

  it("reports tuple-returning custom form hooks as advisory", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/use-editor.ts",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          export function useEditor() {
            const form = useForm({ resolver: zodResolver(schema) });
            return [form];
          }
        `
      );
      await fixture.write(
        "src/page.tsx",
        `
          import { useEditor } from "./use-editor";

          export function Page() {
            const [form] = useEditor();
            return <form onSubmit={form.handleSubmit(save)}><Input /></form>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("advisory");
      expect(
        (await runRule(fixture.rootDir, fieldErrorsRenderedRule)).status
      ).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps generic direct useForm calls applicable to field-error checks", async () => {
    const fixture = await createRuleFixture({
      "@hookform/resolvers": "5.2.2",
      react: "19.2.4",
      "react-hook-form": "7.62.0",
    });

    try {
      await fixture.write(
        "src/page.tsx",
        `
          import { zodResolver } from "@hookform/resolvers/zod";
          import { useForm } from "react-hook-form";

          export function Page() {
            const form = useForm<FormValues>({ resolver: zodResolver(schema) });
            return (
              <form onSubmit={form.handleSubmit(save)}>
                <Input {...form.register("email")} />
                <FormMessage />
              </form>
            );
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, fieldErrorsRenderedRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });
});
