import path from "node:path";
import { findOwnedSourceScopes, parseProjectSourceFiles } from "../ast";
import type { AuditRule } from "../audit";
import { getProjectModuleResolver } from "./module-resolution";
import {
  getPendingAliases,
  resolvePendingThroughProps,
} from "./pending-prop-flow";
import { fail, notApplicable, pass } from "./rule-result";

const ASYNC_ACTION_PATTERN =
  /(?:useActionState|useFormStatus|useTransition|useMutation|\bonSubmit\s*=|<form\b[^>]*\baction\s*=)/;
const PENDING_STATE_PATTERN =
  /\b(?:isPending|pending|isSubmitting|isLoading|loading)\b/;
const PENDING_STATE_NAME_PATTERN =
  /\b(?:isPending|pending|isSubmitting|isLoading|loading)\b/g;
const DISABLED_PENDING_PATTERN =
  /disabled\s*=\s*\{[^}]*(?:isPending|pending|isSubmitting|isLoading|loading)[^}]*\}/;
const VISIBLE_PENDING_PATTERN =
  /<(?:Spinner|Loader\w*)\b|aria-busy\s*=|(?:isPending|pending|isSubmitting|isLoading|loading)\s*\?\s*(?:\(\s*)*(?:["'`][^"'`]+["'`]|<)/;
const TOAST_PROMISE_PENDING_PATTERN =
  /\btoast\.promise\s*\([\s\S]*?\bloading\s*:/;

const getPendingNames = (content: string): string[] => [
  ...new Set(content.match(PENDING_STATE_NAME_PATTERN) ?? []),
];

const asyncActionPendingStateRule: AuditRule = {
  adapters: ["core"],
  category: "states",
  confidence: "medium",
  description:
    "Checks asynchronous actions for visible pending feedback and duplicate-submit prevention.",
  id: "async-action-pending-state",
  maxScore: 4,
  run: async ({ filesystemRoot, project }) => {
    const actionScopes = await findOwnedSourceScopes(
      project,
      ASYNC_ACTION_PATTERN
    );

    if (actionScopes.length === 0) {
      return notApplicable(
        "No recognizable asynchronous action surface was found."
      );
    }

    const parsedFiles = await parseProjectSourceFiles(project);
    const filesByPath = new Map(
      parsedFiles.map((file) => [path.resolve(file.filePath), file])
    );
    const resolver = getProjectModuleResolver(project, filesystemRoot);

    for (const scope of actionScopes) {
      const hasPendingState = PENDING_STATE_PATTERN.test(scope.content);
      const disablesWhilePending = DISABLED_PENDING_PATTERN.test(scope.content);
      const showsPendingFeedback =
        VISIBLE_PENDING_PATTERN.test(scope.content) ||
        TOAST_PROMISE_PENDING_PATTERN.test(scope.content);

      if (hasPendingState && disablesWhilePending && showsPendingFeedback) {
        continue;
      }

      // A shared form component can own the trigger UX, so the pending
      // value is followed into the components it is handed to before the
      // scope is judged incomplete.
      const propFlow = hasPendingState
        ? resolvePendingThroughProps({
            file: scope.file,
            filesByPath,
            names: [
              ...new Set([
                ...getPendingNames(scope.content),
                // A component that renames its pending prop still disables
                // the trigger — under the new name.
                ...getPendingAliases(scope.file, scope.start, scope.end),
              ]),
            ],
            project,
            resolver,
            scopeEnd: scope.end,
            scopeStart: scope.start,
          })
        : { boundary: null, satisfied: false };

      if (propFlow.satisfied) {
        continue;
      }

      const missing = [
        hasPendingState ? null : "pending state",
        showsPendingFeedback ? null : "visible pending feedback",
        disablesWhilePending ? null : "a disabled trigger while pending",
      ].filter((item): item is string => item !== null);
      const boundary = propFlow.boundary
        ? ` Following the pending prop stopped because ${propFlow.boundary}.`
        : "";

      return fail(
        `Async action handling is missing ${missing.join(", ")}.${boundary}`,
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
