# `pyright`

**Area:** Python typing / diagnostics

## Why this matters for PairOfCleats
Use Pyright for optional Python type inference and structured diagnostics output, complementing AST-based Python metadata.

## Implementation notes (practical)
- Use `pyrightconfig.json` to control strictness, excluded paths, and execution environment.
- Prefer JSON output for machine-consumable diagnostics and type info.

## Where it typically plugs into PairOfCleats
- Attach inferred types/diagnostics to Python chunks (opt-in; cache results).
- Use settings to keep runs deterministic in CI (pinned python version / venv selection).

## Deep links (implementation-relevant)
1. Pyright configuration reference (pyrightconfig.json; strictness controls)  https://microsoft.github.io/pyright/#/configuration
2. Command line reference (JSON output, verifytypes, diagnostics)  https://microsoft.github.io/pyright/#/command-line

## Suggested extraction checklist
- [x] Identify the exact API entrypoints you will call and the data structures you will persist. (Planned: run pyright analysis and capture diagnostics/types for Python files.)
- [x] Record configuration knobs that meaningfully change output/performance. (Planned knobs: pythonVersion, pythonPlatform, typeCheckingMode, stubPath.)
- [x] Add at least one representative test fixture and a regression benchmark. (Planned fixture: tests/indexing/type-inference/crossfile/crossfile-output.integration.test.js (python). Planned benchmark: tools/bench/language-repos.js.)
