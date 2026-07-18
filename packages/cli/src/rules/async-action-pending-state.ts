import { findOwnedSourceScopes } from "../ast";
import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";

const ASYNC_ACTION_PATTERN =
  /(?:useActionState|useFormStatus|useTransition|useMutation|\bonSubmit\s*=|<form\b[^>]*\baction\s*=)/;
const PENDING_STATE_PATTERN =
  /\b(?:isPending|pending|isSubmitting|isLoading|loading)\b/;
const DISABLED_PENDING_PATTERN =
  /disabled\s*=\s*\{[^}]*(?:isPending|pending|isSubmitting|isLoading|loading)[^}]*\}/;
const VISIBLE_PENDING_PATTERN =
  /<(?:Spinner|Loader\w*)\b|aria-busy\s*=|(?:isPending|pending|isSubmitting|isLoading|loading)\s*\?\s*(?:\(\s*)*(?:["'`][^"'`]+["'`]|<)/;
const TOAST_PROMISE_PENDING_PATTERN =
  /\btoast\.promise\s*\([\s\S]*?\bloading\s*:/;

const asyncActionPendingStateRule: AuditRule = {
  adapters: ["core"],
  category: "states",
  confidence: "medium",
  description:
    "Checks asynchronous actions for visible pending feedback and duplicate-submit prevention.",
  id: "async-action-pending-state",
  maxScore: 4,
  run: async ({ project }) => {
    const actionScopes = await findOwnedSourceScopes(
      project,
      ASYNC_ACTION_PATTERN
    );

    if (actionScopes.length === 0) {
      return notApplicable(
        "No recognizable asynchronous action surface was found."
      );
    }

    for (const scope of actionScopes) {
      const hasPendingState = PENDING_STATE_PATTERN.test(scope.content);
      const disablesWhilePending = DISABLED_PENDING_PATTERN.test(scope.content);
      const showsPendingFeedback =
        VISIBLE_PENDING_PATTERN.test(scope.content) ||
        TOAST_PROMISE_PENDING_PATTERN.test(scope.content);

      if (hasPendingState && disablesWhilePending && showsPendingFeedback) {
        continue;
      }

      const missing = [
        hasPendingState ? null : "pending state",
        showsPendingFeedback ? null : "visible pending feedback",
        disablesWhilePending ? null : "a disabled trigger while pending",
      ].filter((item): item is string => item !== null);

      return fail(
        `Async action handling is missing ${missing.join(", ")}.`,
        "Expose the action's pending state, show progress in the trigger, and disable duplicate submission until it settles.",
        {
          filePath: scope.file.filePath,
          line: scope.line,
        }
      );
    }

    const firstScope = actionScopes[0];
    return pass(
      "Async actions expose visible pending feedback and disable duplicate submission.",
      firstScope?.file.filePath,
      firstScope?.line
    );
  },
  severity: "warning",
  title: "async actions communicate pending state",
};

export { asyncActionPendingStateRule };
