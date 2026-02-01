# PairOfCleats GigaRoadmap

    ## Status legend
    
    Checkboxes represent the state of the work, update them to reflect the state of work as its being done:
    - [x] Implemented and appears complete/correct based on code inspection and existing test coverage
    - [@] In Progress, this work has been started
    - [.] Work has been completed but has Not been tested
    - [?] There is a correctness gap **or** there is missing/insufficient test proving behavior
    - [x] Not complete
    
    Completed Phases: `COMPLETED_PHASES.md`

### Source-of-truth hierarchy (when specs disagree)
When a document/spec conflicts with the running code, follow this order:

1) **`src/contracts/**` and validators** are authoritative for artifact shapes and required keys.
2) **Current implementation** is authoritative for runtime behavior *when it is already validated by contracts/tests*.
3) **Docs** (`docs/contracts/**`, `docs/specs/**`, `docs/phases/**`) must be updated to match (never the other way around) unless we have a deliberate migration plan.

If you discover a conflict:
- **Prefer "fix docs to match code"** when the code is already contract-validated and has tests.
- **Prefer "fix code to match docs/contracts"** only when the contract/validator is explicit and the code violates it.

### Touchpoints + line ranges (important: line ranges are approximate)
This document includes file touchpoints with **approximate** line ranges like:

- `src/foo/bar.js` **(~L120-L240)**  -  anchor: `someFunctionName`

Line numbers drift as the repo changes. Treat them as a **starting hint**, not a hard reference.
Always use the **anchor string** (function name / constant / error message) as the primary locator.

### Tests: lanes + name filters (use them aggressively)
The repo has a first-class test runner with lanes + filters:

- Runner: `npm test` (alias for `node tests/run.js`)
- List lanes/tags: `npm test -- --list-lanes` / `npm test -- --list-tags`
- Run a lane: `npm run test:unit`, `npm run test:integration`, `npm run test:services`, etc.
- Filter by name/path (selectors):  
  - `npm test -- --match risk_interprocedural`  
  - `npm run test:unit -- --match chunk-uid`  
  - `npm run test:integration -- --match crossfile`

**Lane rules are defined in:** `tests/run.rules.jsonc` (keep new tests named/placed so they land in the intended lane).

### Deprecating spec documents: archive policy (MANDATORY)
When a spec/doc is replaced (e.g., a reconciled spec supersedes an older one):

- **Move the deprecated doc to:** `docs/archived/` (create this folder if missing).
- Keep a short header in the moved file indicating:
  - what replaced it,
  - why it was deprecated,
  - the date/PR.
- Add/update the repository process in **`AGENTS.md`** so future agents follow the same archival convention.

This roadmap includes explicit tasks to enforce this process (see Phase 10 doc merge).

---

## Roadmap Table of Contents
### Features

---

