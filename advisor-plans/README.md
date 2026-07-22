# Shadscan Advisor Plans

These plans are separate from `plans/`, which records the completed OrcDev
ruleset audit. Execute the plans here in numeric order unless a plan says
otherwise.

## Execution Order And Status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| 001 | Scale public web repository scans | P1 | XL | - | DONE |

Status values: TODO | IN PROGRESS | DONE | BLOCKED | REJECTED

## Dependency Notes

- Plan 001 was delivered in seven independently committable slices. The async
  adapter ships disabled and should remain off until selective acquisition and
  cache metrics justify a measured canary threshold.
