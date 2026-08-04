# Plan 019: ButtonGroup holds buttons, not text inputs

> **Executor instructions**: This plan adds **one new rule** that catches a
> text input placed inside shadcn's `ButtonGroup`, where the focus ring
> bisects a control that reads as one object. It is a new rule, so it needs a
> ruleset date bump, a regenerated rule catalog, and the hardcoded catalog
> count in the packed smoke test. It reuses the existing
> `evaluateComponentAnatomy` machinery rather than hand-rolling a JSX walk.
> Add an Unreleased changelog entry, and update `plans/README.md` when done.
>
> **Drift check (run first)**:
> `grep -rn "focus-within" packages/cli/src/rules/` and
> check whether upstream shadcn has changed `button-group.tsx` to use
> `focus-within` — if it has, this rule's premise is gone and the plan should
> be closed rather than executed.

## Status

- **State**: DONE
- **Priority**: P2 — a real, reproducible visual defect that shadcn's own
  component set has a correct answer for, but cosmetic rather than a
  correctness or a11y failure.
- **Effort**: S — the anatomy machinery already does the hard part.
- **Risk**: LOW. Detection is a resolved component identity, not a heuristic
  over utility classes. See "Why this is now low risk" below.
- **Depends on**: none
- **Category**: rules
- **Planned at**: 2026-08-04

## The defect, measured against live code

Reference case: `components/sections/newsletter/kit-newsletter-form.tsx:126-144`
in `~/projects/orcdev` (live on the landing page).

```tsx
<ButtonGroup className="w-full">
  <FormControl>
    <Input placeholder="Email" type="email" {...field} />
  </FormControl>
  <Button className="min-w-28" type="submit">Subscribe</Button>
</ButtonGroup>
```

Note what is **not** there: no `rounded-l-none`, no `border-l-0`, no
`-ml-px`, no `overflow-hidden`. The call site is clean. All the joining
happens inside `ButtonGroup` itself:

```
[&>*:not(:first-child)]:rounded-l-none
[&>*:not(:first-child)]:border-l-0
[&>*:not(:last-child)]:rounded-r-none
```

And `ButtonGroup`'s entire answer to focus is:

```
[&>*]:focus-visible:relative [&>*]:focus-visible:z-10
```

It does not unify the ring — `focus-within` appears **zero** times in
`button-group.tsx`. It lifts the focused child's stacking order so the child's
own ring paints on top of the neighbour's border instead of being clipped.

That is the correct fix **for buttons**. Every segment in a segmented control
has identical geometry and an identical ring, so lifting the focused one reads
as "this segment". It falls apart for a text input, because the shadcn `Input`
in this project carries:

```
focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ring
```

`ring-offset-2` draws a 2px gap and a 2px ring **all the way around the input's
box, including the edge flush against the button**. The result is a ring
running vertically down the middle of a pill that reads as a single control —
square-cornered on the right, with the Subscribe button hanging outside it.

## The framing that makes this a rule

shadcn ships two components for two jobs:

- **`ButtonGroup`** joins buttons. Per-child rings plus `z-10` is right there.
- **`InputGroup`** attaches affordances to a text control. Its wrapper carries
  `has-[[data-slot=input-group-control]:focus-visible]:border-b-ring` and
  `InputGroupInput` carries `focus-visible:ring-0`, so the child delegates its
  ring upward and the whole shape lights up as one.

Using `ButtonGroup` for input+button reaches for the wrong one, and the
bisected focus ring is the symptom that reveals it. This is the same family as
the existing `input-group-composition` rule, and it matches the shadcn skill's
own guidance ("Buttons inside inputs use `InputGroup` + `InputGroupAddon`").

So the rule checks a **crisp structural fact** — a text control inside
`ButtonGroup` — and the focus ring is the *rationale*, not the mechanism. That
is deliberately more robust than pattern-matching focus utilities, which are
unreadable the moment they come from `cva` or a variable.

## Why this is now low risk

The first draft of this plan proposed a heuristic gate over call-site utility
classes (`rounded-l-none`, `border-l-0`, `divide-x`, …) to decide whether a
hand-rolled wrapper was "joined". Reading the live code killed that approach:
**the real example carries none of those classes**, so the gate would have
missed the exact case it was written for, while still being exposed to false
positives on every `<div class="flex gap-2">` in the wild.

Resolving `ButtonGroup` through the ui alias is exact. There is no heuristic
left to be wrong about. Scope is deliberately limited to that component.

## Scope

**In scope**: `ButtonGroup` (resolved from `project.shadcn.aliases.ui`)
containing a text-entry control — `Input`, `Textarea`, a native `<input>`, or a
native `<textarea>`.

**Out of scope, deliberately**:

- `ButtonGroup` holding only buttons, selects, or `ButtonGroupText`. That is
  the component working as designed.
- Hand-rolled `<div class="flex">` composites. No reliable signal, high false
  positive cost, and the shadcn-using population is who shadscan serves.
  Revisit only if burn-in shows real demand.
- `InputGroup`. It delegates correctly; `input-group-composition` owns it.
- `<input type="checkbox">` / `type="radio"` / `type="submit"` / `type="button"`
  inside a ButtonGroup — those are not text entry and do not carry the
  offset ring. Exclude by `type` where it is statically readable.

## Phase 1 — The rule, via the existing anatomy machinery

`evaluateComponentAnatomy` (`packages/cli/src/anatomy.ts:51`) already expresses
exactly this: a `ComponentAnatomyManifest` with a `forbidden` list of child
components, resolved against the ui alias, returning a violation with file,
line, message and remediation. `input-group-composition.ts` is a 99-line
worked example to copy.

`packages/cli/src/rules/button-group-holds-only-buttons.ts`:

```ts
const BUTTON_GROUP_MANIFEST: ComponentAnatomyManifest = {
  allowIcon: false,
  component: "ButtonGroup",
  forbidden: [
    { component: "Input", moduleFile: "input", remediation: "…" },
    { component: "Textarea", moduleFile: "textarea", remediation: "…" },
    { component: "a native input", moduleFile: null, nativeTag: "input", remediation: "…" },
    { component: "a native textarea", moduleFile: null, nativeTag: "textarea", remediation: "…" },
  ],
  moduleFile: "button-group",
  requiredParts: [],
};
```

- `adapters: ["core"]`, `category: "forms"`, `severity: "warning"`
- `confidence: "medium"`, `maxScore: 0`, returning `advisory()` — matching
  `input-group-composition`'s calibration exactly. See Phase 3.
- `notApplicable` when `project.shadcn.configPath` is absent, and when zero
  `ButtonGroup` instances are found.

**Remediation string** (this is the product; write it carefully):

> Move the input into an InputGroup with InputGroupInput and an
> InputGroupAddon, which lights the whole control on focus. ButtonGroup keeps
> a per-child focus ring, so the ring covers only the input and stops where
> the button begins.

**One thing to verify before writing the manifest**: confirm
`evaluateComponentAnatomy` matches on **direct children only**, or that
`<FormControl>` wrapping the `<Input>` (as in the reference case) does not
defeat detection. The live example nests
`ButtonGroup > FormControl > Input`, so if the walk is direct-children-only it
will miss the primary case. If it is, either extend the walk to descend
through non-ui wrappers or add `FormControl` to a pass-through list —
**and write the nested case as a test first**, because it is the shape that
actually ships.

## Phase 2 — Tests

In `packages/cli/test/anatomy-rules.test.ts` (where `input-group-composition`
is already tested).

Must fire:
- `ButtonGroup > Input + Button`
- `ButtonGroup > FormControl > Input` + `Button` — **the live shape**
- `ButtonGroup > <input type="email">` + `Button`
- `ButtonGroup > Textarea + Button`

Must stay silent:
- `ButtonGroup > Button + Button` (segmented control — the intended use)
- `ButtonGroup > Button + ButtonGroupText`
- `InputGroup > InputGroupInput + InputGroupAddon`
- a project with no `components.json`
- a project that imports `ButtonGroup` from somewhere other than the ui alias

## Phase 3 — Register, regenerate, and the three easy-to-miss surfaces

- register in `packages/cli/src/rules/default-rules.ts` **and**
  `packages/cli/src/rule-catalog.ts`
- **bump `BUNDLED_RULESET_VERSION`** in `packages/cli/src/scan.ts`
  (`2026.07.41` → next date version)
- **regenerate the catalog**: `docs/rules.md` and
  `lib/generated/rule-catalog.json` are generated by
  `packages/cli/scripts/generate-rule-catalog.ts`. Never hand-edit;
  `pnpm docs:check` fails on drift.
- **bump the hardcoded count**: `packages/cli/scripts/smoke-package.mjs:250`
  asserts `RULE_CATALOG.length !== 59` → must become `60`. This fails late,
  after a full build and npm pack, with a message that says nothing about rule
  counts. Change it in the same commit.

Ships **advisory** (`maxScore: 0` → `impactsScore: false`, `audit.ts:543`), so
it reports in findings and the agent handoff without moving anyone's score —
the same calibration `input-group-composition` has had since plan 006.

Promote to `maxScore: 2` only after burn-in shows zero false positives, and
note the trap: `fail()` with `confidence: "low"` is silently auto-downgraded
back to advisory at `audit.ts:541`, so promotion must change **maxScore,
confidence, and the result helper together**. Assert `impactsScore === true`
in a test so it cannot regress.

## Phase 4 — Burn-in on the case that motivated it

The primary burn-in target is `~/projects/orcdev`, which has exactly one
`ButtonGroup` call site and it is the defect. Success is: the rule fires once,
names `kit-newsletter-form.tsx`, and the remediation is followed by actually
converting that form to `InputGroup` and confirming the ring wraps the whole
pill.

Then run against at least three other shadcn projects to confirm segmented
`ButtonGroup` usage stays silent.

**Note**: `pnpm audit:self` will *not* exercise this rule — shadscan's own site
has no `button-group.tsx` in `components/ui/`. Do not treat a clean self-audit
as evidence the rule works.

## Verification (every phase)

```bash
pnpm check && pnpm --filter ./packages/cli typecheck && pnpm cli:test
pnpm docs:check          # catches an unregenerated rule catalog
pnpm cli:smoke           # catches the stale RULE_CATALOG.length
```

## Open questions / risks

- **Is this shadcn's bug or the user's?** Arguably upstream could add
  `focus-within` to `ButtonGroup`. But `InputGroup` already exists for this
  composition, so "use the right component" is the better remediation than
  "patch the wrong one". If upstream does add it, close this plan (see the
  drift check).
- **`ring-offset-2` is not universal.** This project's `Input` uses
  `ring-offset-2`; newer shadcn presets use `ring-[3px]` with no offset, where
  the bisection is less pronounced but still present. The rule keys on
  composition, not ring geometry, so it holds either way — but the changelog
  copy should not overstate the severity.
- **`forms` vs `interaction` category.** Chose `forms` to sit beside
  `input-group-composition`, and because detection requires a text control.
  Cheap to move before release, expensive after (category drives weights).
