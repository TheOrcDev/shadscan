# Plan 020: Questionnaire items are composed completely

> **Executor instructions**: This plan adds **one new rule** covering shadcn's
> new `questionnaire` component: a required item with nowhere to render its
> validation error, and an item with no title. It is a new rule, so it needs a
> ruleset date bump, a regenerated catalog, and **both** hardcoded catalog
> counts. It ships advisory, and — unlike plan 019 — **cannot be burned in**,
> because the component has no adoption yet. Read "Why this cannot be burned
> in" before deciding to execute. Add an Unreleased changelog entry, and update
> `plans/README.md` when complete.
>
> **Drift check (run first)**:
> `pnpm dlx shadcn@rc search @shadcn -q "questionnaire"` and
> `npm view @shadcn/react version`
> This plan was written against `@shadcn/react@0.3.0`. If the primitive has
> gone 1.0 or the part names changed, re-derive the contract from the registry
> before writing code — do not trust the names below.

## Status

- **State**: DONE
- **Priority**: P3 — real defects, but on a component with effectively zero
  adoption today. The value is being early rather than fixing live pain.
- **Effort**: S
- **Risk**: MEDIUM, and of an unusual kind. Detection is exact (resolved
  component identity, same as plan 019), so false positives are unlikely.
  The risk is **churn**: the contract belongs to a six-week-old pre-1.0
  package, and there is no real-world corpus to validate against.
- **Depends on**: none
- **Category**: rules
- **Planned at**: 2026-08-05

## What the component actually is (measured 2026-08-05)

`questionnaire` is `registry:ui` in the `@shadcn` registry, exporting **15**
parts: `Questionnaire`, `QuestionnaireProgress`, `QuestionnaireItem`,
`QuestionnaireTitle`, `QuestionnaireDescription`, `QuestionnaireChoices`,
`QuestionnaireChoice`, `QuestionnaireChoiceDescription`, `QuestionnaireInput`,
`QuestionnaireError`, `QuestionnaireActions`, `QuestionnairePrevious`,
`QuestionnaireSkip`, `QuestionnaireNext`, `QuestionnaireSubmit`.

**It is a thin styling wrapper**, not a self-contained component. Every part
delegates to `@shadcn/react/questionnaire` — a headless primitive at version
**0.3.0**, first published 2026-06-26. The copied file holds Tailwind classes
and `data-slot` attributes; the state machine, context, focus management and
aria wiring live in the primitive.

That distinction decides the scope below.

## The two defects

Both are measured against shadcn's own `questionnaire-example`, which contains
7 `QuestionnaireItem` blocks.

**1. A required item with no `QuestionnaireError`.** Validation fails, and the
item has nowhere to say so: the user presses Next, nothing moves, and no
explanation appears. A silent dead end on a submit button is the exact defect
family shadscan already covers with `field-errors-rendered` and
`invalid-fields-associated-with-errors`.

*Evidence it is the convention*: **5 of 5** required items in the official
example render `<QuestionnaireError />`.

**2. An item with no `QuestionnaireTitle`.** The question has no label. Nothing
tells the user — or a screen reader — what is being asked.

*Evidence*: **7 of 7** items in the official example have a `QuestionnaireTitle`.

## Scope

**In scope**: `QuestionnaireItem` resolved through `project.shadcn.aliases.ui`,
checked for a `QuestionnaireError` descendant when `required` is statically
true, and for a `QuestionnaireTitle` descendant always.

**Out of scope, deliberately**:

- **Anything the primitive owns**: focus movement between items, aria
  associations, error-to-input wiring, keyboard shortcuts, progress
  calculation. None of that is in the file the user copies, so none of it is
  theirs to get wrong. Checking it would be auditing `@shadcn/react`, which is
  not shadscan's job and would break on every primitive release.
- **`QuestionnaireChoice` outside `QuestionnaireChoices`.** Structurally real,
  but the primitive almost certainly rejects it at runtime, and the example
  gives zero instances of the mistake. Not worth a check nobody will hit.
- **A dynamic `required`.** `required={isRequired}` resolves as `dynamic`;
  treat it as not-required and stay silent. Same reasoning as plan 019's
  lone-child fix: for an advisory rule, a false positive costs more than a
  miss.
- **Items composed across component boundaries.** If the `QuestionnaireItem`
  and its parts live in different files, the descendant walk cannot see them.
  Count the instance as uncertain and do not report it.

## Phase 1 — The rule

`packages/cli/src/rules/questionnaire-item-composition.ts`.

**Follow the shape of `button-group-holds-only-buttons.ts`, not the anatomy
machinery.** Checked both, and neither existing helper fits:

- `evaluateComponentAnatomy` reads **direct children only** and reports any
  unrecognised child as a violation. `QuestionnaireItem` legitimately holds
  arbitrary wrappers, so it would false-positive immediately.
- `evaluateContainerContracts` checks an **ancestor** chain (item inside
  group inside context). This rule needs the opposite: **descendant presence**.

So: resolve `QuestionnaireItem` via `collectUiModuleImports(sourceFile,
uiAlias, "questionnaire")` + `resolveUiTagName`, then walk each item's subtree
for `QuestionnaireTitle` and `QuestionnaireError`. That pattern is proven and
already in the codebase.

Rule shape:

- `adapters: ["core"]`, `category: "forms"`, `severity: "warning"`
- `confidence: "medium"`, `maxScore: 0`, returning `advisory()`
- `notApplicable` when `project.shadcn.configPath` is absent, and when no
  `QuestionnaireItem` instances are found
- Report the first violation only, matching every sibling rule

Two messages, since the remediations differ:

- missing error → `A required questionnaire item has no QuestionnaireError, so
  a failed answer has nowhere to explain itself.` → *Add `<QuestionnaireError />`
  inside the item so validation failures are visible.*
- missing title → `A questionnaire item has no QuestionnaireTitle, so the
  question is unlabelled.` → *Add a `<QuestionnaireTitle>` naming the question.*

Check the title first: an item with neither problem should report the more
fundamental one.

## Phase 2 — Tests

New file `packages/cli/test/questionnaire-item-composition.test.ts`, mirroring
plan 019's suite.

Must fire:
- `<QuestionnaireItem required>` with a Title and Choices but no Error
- `<QuestionnaireItem>` with no Title
- an Error nested one level deeper than a direct child (a wrapper `<div>`
  between) — proving the walk descends, which is what caught plan 019

Must stay silent:
- the canonical shape: `Item required > Title + Choices > Choice + Error`
- a **non-required** item with no Error
- `required={maybe}` — dynamic, so unknown, so quiet
- a `Questionnaire` imported from outside the ui alias
- a project with no `components.json`

## Phase 3 — Register, regenerate, and the surfaces that bite

Every one of these was missed at least once during plan 019. Do all five.

- register in `packages/cli/src/rules/default-rules.ts` (`rule-catalog.ts`
  derives from it, so no second registration)
- **bump `BUNDLED_RULESET_VERSION`** in `packages/cli/src/scan.ts`
  (`2026.07.42` → next)
- **regenerate**: `pnpm docs:rules`, never hand-edit `docs/rules.md` or
  `lib/generated/rule-catalog.json`
- **bump both hardcoded counts** from 60 to 61:
  - `packages/cli/test/public-api.test.ts` (`toHaveLength`)
  - `packages/cli/scripts/smoke-package.mjs` (`RULE_CATALOG.length !==`) —
    fails only after a full build and npm pack, with a message that never
    mentions rule counts
- **the advertised rule counts** in `README.md` and `packages/cli/README.md`
  (two each). `pnpm docs:check` now enforces this, courtesy of the gate added
  in `2348427`.

## Why this cannot be burned in, and what to do instead

Plan 019 earned its confidence on nine real projects. There is no equivalent
corpus here: the component shipped days ago and nobody has adopted it. The
honest substitute is narrow:

1. Install the real component into a scratch shadcn app
   (`pnpm dlx shadcn@rc add @shadcn/questionnaire`) and confirm the rule stays
   **silent** on the untouched `questionnaire-example` composition. That is the
   single most valuable check available — the official example is the
   definition of correct usage, so any hit on it is a false positive by
   definition.
2. Then break it deliberately — delete the `<QuestionnaireError />` from a
   required item — and confirm the rule fires with the right line.

That is a corpus of one, and the plan should not pretend otherwise. It is the
reason this ships advisory and stays there until the component sees real use.

## Verification (every phase)

```bash
pnpm check && pnpm --filter ./packages/cli typecheck && pnpm cli:test
pnpm docs:check   # catches the catalog and the advertised counts
pnpm cli:smoke    # catches the stale RULE_CATALOG.length
```

`pnpm audit:self` will not exercise this rule — the site has no
`questionnaire.tsx`. A clean self-audit proves nothing here.

## Open questions / risks

- **Pre-1.0 churn is the main cost.** `@shadcn/react@0.3.0` is six weeks old.
  If part names change, this rule silently stops matching — it resolves by
  name, so a rename produces silence rather than a failure. Worth a note in
  the rule's comment so a future reader knows why it might have gone quiet.
- **One rule or two?** Missing-error is `forms`; missing-title is closer to
  `accessibility`. Kept as one rule in `forms` because `input-group-composition`
  and `items-belong-to-groups` both bundle related composition checks, and
  because splitting doubles the catalog cost of a component nobody uses yet.
  Revisit if adoption makes the two behave differently.
- **Is P3 worth doing at all right now?** The counterweight is that the rule is
  `notApplicable` for every project without the component, so it costs nothing
  to those who never touch it, and being early on a just-shipped shadcn
  component is a real differentiator for a tool that tracks shadcn closely.
  If that framing stops being true, close this plan rather than executing it.
