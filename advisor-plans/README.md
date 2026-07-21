# Shadscan Advisor Plans

These plans are separate from `plans/`, which records the completed OrcDev
ruleset audit. Execute the plans here in numeric order unless a plan says
otherwise.

## Execution Order And Status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| 001 | Scale public web repository scans | P1 | XL | - | TODO |

Status values: TODO | IN PROGRESS | DONE | BLOCKED | REJECTED

## Dependency Notes

- Plan 001 is intentionally split into seven independently committable slices.
- Do not begin the asynchronous slice until selective acquisition and caching
  are deployed and measured. A queue must not hide avoidable source-loading
  work.
