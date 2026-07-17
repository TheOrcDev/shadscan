import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";
import { getProjectSourceFiles, getTextLineNumber } from "./source-files";

const ASYNC_ACTION_PATTERN =
  /(?:useActionState|useFormStatus|useTransition|useMutation|\bonSubmit\s*=|<form\b[^>]*\baction\s*=)/;
const PENDING_STATE_PATTERN =
  /\b(?:isPending|pending|isSubmitting|isLoading|loading)\b/;
const DISABLED_PENDING_PATTERN =
  /disabled\s*=\s*\{[^}]*(?:isPending|pending|isSubmitting|isLoading|loading)[^}]*\}/;
const VISIBLE_PENDING_PATTERN =
  /<(?:Spinner|Loader\w*)\b|aria-busy\s*=|(?:isPending|pending|isSubmitting|isLoading|loading)\s*\?\s*(?:["'`][^"'`]+["'`]|<)/;

const asyncActionPendingStateRule: AuditRule = {
  adapters: ["core"],
  category: "states",
  confidence: "medium",
  description:
    "Checks asynchronous actions for visible pending feedback and duplicate-submit prevention.",
  id: "async-action-pending-state",
  maxScore: 4,
  run: async ({ project }) => {
    const files = await getProjectSourceFiles(project);
    const actionFile = files.find((file) =>
      ASYNC_ACTION_PATTERN.test(file.content)
    );

    if (!actionFile) {
      return notApplicable(
        "No recognizable asynchronous action surface was found."
      );
    }

    const projectSource = files.map((file) => file.content).join("\n");
    const hasPendingState = PENDING_STATE_PATTERN.test(projectSource);
    const disablesWhilePending = DISABLED_PENDING_PATTERN.test(projectSource);
    const showsPendingFeedback = VISIBLE_PENDING_PATTERN.test(projectSource);

    if (hasPendingState && disablesWhilePending && showsPendingFeedback) {
      return pass(
        "Async actions expose visible pending feedback and disable duplicate submission.",
        actionFile.path,
        getTextLineNumber(actionFile.content, ASYNC_ACTION_PATTERN)
      );
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
        filePath: actionFile.path,
        line: getTextLineNumber(actionFile.content, ASYNC_ACTION_PATTERN),
      }
    );
  },
  severity: "warning",
  title: "async actions communicate pending state",
};

export { asyncActionPendingStateRule };
