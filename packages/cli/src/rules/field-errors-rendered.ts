import { findOwnedSourceScopes } from "../ast";
import type { AuditRule } from "../audit";
import { analyzeFormHookFlow, getSourceScopeKey } from "./form-hook-flow";
import { advisory, fail, notApplicable, pass } from "./rule-result";

const CUSTOM_VALIDATION_PATTERN =
  /\b(?:formState\.errors|fieldState\.error|errors\.\w+|useActionState|useForm(?:\s*<[^;{}]*>)?\s*\()/;
const RENDERED_ERROR_PATTERN =
  /<(?:FieldError|FormMessage|ErrorMessage)(?:\s|>)|role\s*=\s*["']alert["']|(?:formState\.errors|fieldState\.error|errors\.\w+)\s*(?:&&|\?)/;

const fieldErrorsRenderedRule: AuditRule = {
  adapters: ["core"],
  category: "forms",
  confidence: "medium",
  description: "Checks custom form-validation state for rendered field errors.",
  id: "field-errors-rendered",
  maxScore: 3,
  run: async ({ filesystemRoot, project }) => {
    const hookFlow = await analyzeFormHookFlow(project, filesystemRoot);
    const directValidationScopes = (
      await findOwnedSourceScopes(project, CUSTOM_VALIDATION_PATTERN)
    ).filter(
      (scope) => !hookFlow.providerScopeKeys.has(getSourceScopeKey(scope))
    );
    const validationScopesByKey = new Map(
      directValidationScopes.map((scope) => [getSourceScopeKey(scope), scope])
    );
    const uncertainScopesByKey = new Map<
      string,
      (typeof directValidationScopes)[number]
    >();

    for (const flows of hookFlow.flowsByConsumerKey.values()) {
      for (const flow of flows) {
        const key = getSourceScopeKey(flow.consumer);

        if (flow.kind === "resolved") {
          validationScopesByKey.set(key, flow.consumer);
          uncertainScopesByKey.delete(key);
        } else if (!validationScopesByKey.has(key)) {
          uncertainScopesByKey.set(key, flow.consumer);
        }
      }
    }

    const validationScopes = [...validationScopesByKey.values()];

    if (validationScopes.length === 0 && uncertainScopesByKey.size === 0) {
      return notApplicable("No custom form-validation state was found.");
    }

    for (const scope of validationScopes) {
      if (RENDERED_ERROR_PATTERN.test(scope.content)) {
        continue;
      }

      return fail(
        "Custom validation state exists, but its form surface renders no field-error UI.",
        "Render field errors with FieldError/FormMessage, an explicit error branch, or another visible error component.",
        {
          filePath: scope.file.filePath,
          line: scope.line,
        }
      );
    }

    for (const scope of uncertainScopesByKey.values()) {
      if (RENDERED_ERROR_PATTERN.test(scope.content)) {
        continue;
      }

      return advisory(
        "A form uses a custom hook whose field-error state could not be traced.",
        "Keep the returned useForm instance in a statically traceable custom-hook chain, or verify that this form renders field errors.",
        scope.file.filePath,
        scope.line
      );
    }

    const firstScope =
      validationScopes[0] ?? uncertainScopesByKey.values().next().value;
    return pass(
      "Custom validation errors are rendered in their form UI.",
      firstScope?.file.filePath,
      firstScope?.line
    );
  },
  severity: "error",
  title: "field validation errors are rendered",
};

export { fieldErrorsRenderedRule };
