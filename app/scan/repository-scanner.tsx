"use client";

import {
  ArrowClockwiseIcon,
  GithubLogoIcon,
  MagnifyingGlassIcon,
  TerminalWindowIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useActionState, useEffect, useRef, useState } from "react";
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
const CLI_FALLBACK_CODES = new Set<WebScanErrorCode>([
  "PRIVATE_REPOSITORY_UNSUPPORTED",
  "PROJECT_DISCOVERY_FAILED",
  "SOURCE_TOO_LARGE",
  "SOURCE_UNSUPPORTED",
]);
const LOCAL_SCAN_COMMAND = "npx @shadscan/cli@next";

function CliFallback() {
  return (
    <div className="mt-3 flex min-w-0 items-center gap-2 border-destructive/20 border-t pt-3">
      <TerminalWindowIcon aria-hidden="true" className="shrink-0" />
      <code className="min-w-0 flex-1 truncate text-foreground text-xs">
        {LOCAL_SCAN_COMMAND}
      </code>
      <CopyButton
        aria-label="Copy local scan command"
        size="sm"
        text={LOCAL_SCAN_COMMAND}
        variant="outline"
      >
        Copy command
      </CopyButton>
    </div>
  );
}

function RepositoryScanner() {
  const [state, formAction, isPending] = useActionState(
    scanGitHubRepository,
    INITIAL_SCAN_STATE
  );
  const [repositoryInput, setRepositoryInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const inputError =
    state.status === "error" && state.error.code === "INVALID_REPOSITORY";

  useEffect(() => {
    if (state.status === "complete") {
      resultHeadingRef.current?.focus();
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
                {isPending ? "Scanning" : "Scan"}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          {inputError ? (
            <FieldError id={REPOSITORY_ERROR_ID}>
              {state.error.message}
            </FieldError>
          ) : null}
        </Field>
      </form>

      <p aria-live="polite" className="sr-only">
        {isPending ? "Scanning repository" : null}
        {!isPending && state.status === "complete"
          ? `Scan complete. Score ${state.result.report.score ?? "unassessed"}.`
          : null}
      </p>

      {isPending ? <ScanLoading /> : null}

      {!isPending && state.status === "idle" ? (
        <Empty className="min-h-80 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MagnifyingGlassIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No scan yet</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : null}

      {!isPending && state.status === "error" && !inputError ? (
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
            {CLI_FALLBACK_CODES.has(state.error.code) ? <CliFallback /> : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {!isPending && state.status === "complete" ? (
        <ScanResult headingRef={resultHeadingRef} state={state} />
      ) : null}
    </div>
  );
}

export { RepositoryScanner };
