# Test Taxonomy

## Categories
- `hero`: standalone behavior coverage for a meaningful user-facing or subsystem flow.
- `matrix`: parameterized coverage where one authored file intentionally replaces many thin near-duplicates.
- `meta`: guardrails for CI, generated surfaces, manifests, coverage contracts, runner behavior, or contributor policy.
- `soak`: intentionally long-running operational or recovery coverage.
- `heavy-runtime`: non-soak tests that are expensive enough to belong in the long lane.

## Authoring Rules
- Add a new matrix case instead of a new file when the setup, assertions, and failure mode are fundamentally the same and only a bounded input surface changes.
- Keep a standalone hero test when it is the clearest debug point for a full workflow, peripheral integration surface, or high-signal end-to-end behavior.
- Use process isolation when the test mutates global process state, depends on argv/env semantics, or validates CLI/stdout/stderr contracts.
- Put tests in `heavy-runtime` only when they are deterministic but too expensive for the short or medium duration buckets.
- Use `soak` only for intentionally long operational or recovery coverage.

## Matrix Design
- Prefer `one expensive setup, many assertions` for index builds, API/server boot, CLI cold start, provider/session bootstrap, and fixture search contracts.
- Prefer pairwise or boundary-focused case selection when exhaustive permutations do not materially improve defect detection.
- Add a new matrix file only when the case table would otherwise become too heterogeneous to debug clearly.
- Keep case names explicit inside matrix suites so one failing row is obvious in stderr and log output.

## Process Isolation
- A new standalone file should justify process isolation with a concrete reason:
  - global `process` state mutation
  - true CLI argv/stdout/stderr contract validation
  - child-process lifecycle or signal handling
  - runtime/toolchain state that cannot be safely reset in-process
- Process isolation is not justified solely because a variation uses a different language, fixture file, or filter combination.

## Replacement Policy
- When a matrix suite replaces older standalone files, add a machine-readable entry in `docs/testing/consolidation-ownership.json`.
- Every removal must name the surviving owner suite and list the replaced legacy test ids explicitly.
- High-risk consolidations should keep an overlap window long enough to run both old and new coverage before the legacy file is deleted.
- `covered elsewhere` is not an acceptable replacement note.

## Negative-Path Stderr
- Passing tests may emit stderr only when stderr is part of the asserted contract.
- Use the phrase `negative-path stderr` in contributor discussion and review when stderr is intentionally part of a passing test contract.
- If stderr is expected, the test should make that expectation obvious in its name, comments, or assertions.
- Register stable expected-stderr cases in `docs/testing/diagnostics-governance.json` so runner artifacts can distinguish intentional stderr from suspicious noise.
- Do not rely on incidental warnings or uncaptured noise to make a negative-path test pass.

## Peripheral Tooling
- Treat install, VS Code, Sublime, and config-inventory suites as discoverable taxonomy cohorts, not as one-off files.
- Prefer matrix coverage for repeated tool-detection and fixture-shape variations inside those cohorts.
- Keep one or two hero tests per peripheral surface for the highest-signal workflow and diagnostics path.

## Contributor Guidance
- Delete stale placeholder tests instead of keeping green filler artifacts.
- Prefer shared helpers and declarative case tables before adding another near-duplicate file.
- Keep category selection explicit in authored intent even when the runner infers the final metadata.
