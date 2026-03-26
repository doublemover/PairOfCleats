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

## Negative-Path Stderr
- Passing tests may emit stderr only when stderr is part of the asserted contract.
- Use the phrase `negative-path stderr` in contributor discussion and review when stderr is intentionally part of a passing test contract.
- If stderr is expected, the test should make that expectation obvious in its name, comments, or assertions.
- Do not rely on incidental warnings or uncaptured noise to make a negative-path test pass.

## Contributor Guidance
- Delete stale placeholder tests instead of keeping green filler artifacts.
- Prefer shared helpers and declarative case tables before adding another near-duplicate file.
- Keep category selection explicit in authored intent even when the runner infers the final metadata.
