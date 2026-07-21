"use client";

import {
  ArrowClockwiseIcon,
  GithubLogoIcon,
  MagnifyingGlassIcon,
  TerminalWindowIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import {
  type RefObject,
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react";
import { CopyButton } from "@/components/copy-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import {
  MAX_REPOSITORY_INPUT_LENGTH,
  type WebScanErrorCode,
  type WebScanState,
} from "@/lib/shadscan-web/types";
import { scanGitHubRepository } from "./actions";
import { ScanLoading } from "./scan-loading";
import { ScanResult } from "./scan-result";

const INITIAL_SCAN_STATE = { status: "idle" } as const satisfies WebScanState;
const REPOSITORY_FORM_ID = "scan-repository-form";
const REPOSITORY_INPUT_ID = "github-repository";
const REPOSITORY_ERROR_ID = "github-repository-error";
const PROJECT_SELECT_ID = "github-project-path";
const CLI_FALLBACK_CODES = new Set<WebScanErrorCode>([
  "PRIVATE_REPOSITORY_UNSUPPORTED",
  "PROJECT_DISCOVERY_FAILED",
  "SCAN_TIMEOUT",
  "SCAN_WORKER_FAILED",
  "SOURCE_TOO_LARGE",
  "SOURCE_UNSUPPORTED",
]);
const LOCAL_SCAN_COMMAND = "npx @shadscan/cli@next";

function CliFallback({ projectPath }: { projectPath?: string }) {
  const command =
    projectPath && projectPath !== "."
      ? `${LOCAL_SCAN_COMMAND} ${projectPath}`
      : LOCAL_SCAN_COMMAND;

  return (
    <div className="mt-3 flex min-w-0 items-center gap-2 border-destructive/20 border-t pt-3">
      <TerminalWindowIcon aria-hidden="true" className="shrink-0" />
      <code className="min-w-0 flex-1 truncate text-foreground text-xs">
        {command}
      </code>
      <CopyButton
        aria-label="Copy local scan command"
        size="sm"
        text={command}
        variant="outline"
      >
        Copy command
      </CopyButton>
    </div>
  );
}

const getSubmitLabel = (isPending: boolean, state: WebScanState): string => {
  if (isPending) {
    return "Scanning";
  }
  return state.status === "project_selection_required"
    ? "Scan project"
    : "Scan";
};

function ProjectSelector({
  disabled,
  selectRef,
  state,
}: {
  disabled: boolean;
  selectRef: RefObject<HTMLSelectElement | null>;
  state: Extract<WebScanState, { status: "project_selection_required" }>;
}) {
  return (
    <Field className="mt-5">
      <FieldLabel htmlFor={PROJECT_SELECT_ID}>Project</FieldLabel>
      <select
        className="h-9 w-full border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        defaultValue=""
        disabled={disabled}
        id={PROJECT_SELECT_ID}
        name="projectPath"
        ref={selectRef}
        required
      >
        <option disabled value="">
          Choose a project
        </option>
        {state.projects.map((project) => (
          <option key={project.path} value={project.path}>
            {project.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

function RepositoryForm() {
  const [state, formAction, isPending] = useActionState(
    scanGitHubRepository,
    INITIAL_SCAN_STATE
  );
  const [repositoryInput, setRepositoryInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const projectSelectRef = useRef<HTMLSelectElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const inputError =
    state.status === "error" && state.error.code === "INVALID_REPOSITORY";
  const inputErrorMessage = state.status === "error" ? state.error.message : "";

  useEffect(() => {
    if (state.status === "complete") {
      resultHeadingRef.current?.focus();
      return;
    }

    if (state.status === "project_selection_required") {
      projectSelectRef.current?.focus();
      return;
    }

    if (inputError) {
      inputRef.current?.focus();
    }
  }, [inputError, state.status]);

  return (
    <div className="flex w-full flex-col gap-8">
      <form action={formAction} id={REPOSITORY_FORM_ID}>
        <Field data-disabled={isPending} data-invalid={inputError}>
          <FieldLabel htmlFor={REPOSITORY_INPUT_ID}>
            GitHub repository
          </FieldLabel>
          <InputGroup data-disabled={isPending}>
            <InputGroupInput
              aria-describedby={inputError ? REPOSITORY_ERROR_ID : undefined}
              aria-invalid={inputError}
              autoCapitalize="none"
              autoComplete="url"
              disabled={isPending}
              id={REPOSITORY_INPUT_ID}
              maxLength={MAX_REPOSITORY_INPUT_LENGTH}
              name="repository"
              onChange={(event) => {
                setRepositoryInput(event.target.value);
              }}
              placeholder="owner/repository or https://github.com/owner/repository"
              ref={inputRef}
              required
              spellCheck={false}
              value={repositoryInput}
            />
            <InputGroupAddon align="inline-start">
              <GithubLogoIcon aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                disabled={isPending}
                size="sm"
                type="submit"
                variant="default"
              >
                {isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <MagnifyingGlassIcon
                    aria-hidden="true"
                    data-icon="inline-start"
                  />
                )}
                {getSubmitLabel(isPending, state)}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          {inputError ? (
            <FieldError id={REPOSITORY_ERROR_ID}>
              {inputErrorMessage}
            </FieldError>
          ) : null}
        </Field>

        {state.status === "project_selection_required" ? (
          <ProjectSelector
            disabled={isPending}
            selectRef={projectSelectRef}
            state={state}
          />
        ) : null}

        {state.status === "error" && state.projectPath ? (
          <input name="projectPath" type="hidden" value={state.projectPath} />
        ) : null}
      </form>

      <p aria-live="polite" className="sr-only">
        {getLiveStatus(isPending, state)}
      </p>
      <ScanFeedback
        inputError={inputError}
        isPending={isPending}
        resultHeadingRef={resultHeadingRef}
        state={state}
      />
    </div>
  );
}

const getLiveStatus = (isPending: boolean, state: WebScanState): string => {
  if (isPending) {
    return "Scanning repository";
  }
  if (state.status === "complete") {
    return `Scan complete. Score ${state.result.report.score ?? "unassessed"}.`;
  }
  return state.status === "project_selection_required"
    ? "Choose a project to scan."
    : "";
};

function ScanFeedback({
  inputError,
  isPending,
  resultHeadingRef,
  state,
}: {
  inputError: boolean;
  isPending: boolean;
  resultHeadingRef: RefObject<HTMLHeadingElement | null>;
  state: WebScanState;
}) {
  if (isPending) {
    return <ScanLoading />;
  }
  if (state.status === "idle") {
    return (
      <Empty className="min-h-80 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MagnifyingGlassIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No scan yet</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }
  if (state.status === "error" && !inputError) {
    return (
      <Alert variant="destructive">
        <WarningCircleIcon aria-hidden="true" />
        <AlertTitle>Scan failed</AlertTitle>
        <AlertDescription>
          <p>{state.error.message}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {state.error.retryable ? (
              <Button
                form={REPOSITORY_FORM_ID}
                size="sm"
                type="submit"
                variant="outline"
              >
                <ArrowClockwiseIcon
                  aria-hidden="true"
                  data-icon="inline-start"
                />
                Retry
              </Button>
            ) : null}
          </div>
          {CLI_FALLBACK_CODES.has(state.error.code) ? (
            <CliFallback projectPath={state.projectPath} />
          ) : null}
        </AlertDescription>
      </Alert>
    );
  }
  return state.status === "complete" ? (
    <ScanResult headingRef={resultHeadingRef} state={state} />
  ) : null;
}

function RepositoryScanner() {
  return <RepositoryForm />;
}

export { RepositoryScanner };
