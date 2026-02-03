# Roadmap Checklist Rules

This guide defines checklist rules used across roadmaps and plans.

## Checklist update rules
- Only mark a task complete **at the same time** the commit that implements it is made.
- Tests may only be checked after they **run and pass**.
- If a test fix fails, log the attempt under the test checkbox with the error summary.
- After three failed attempts, log the failure and move on.

## Required checklist fields
Each phase SHOULD list:
- Objective
- Goals / Non-goals
- Files to modify
- Docs/specs to update
- Tests to add/run
- Acceptance criteria

## Recommended checklist format
```
### Tasks
- [ ] Task group
- [ ] Subtask detail

### Tests
- [ ] tests/path/to/test-a.test.js
- [ ] tests/path/to/test-b.test.js
```

## Commit discipline
- Keep checklist updates aligned with actual code changes.
- Avoid checking boxes based only on inspection or assumptions.
