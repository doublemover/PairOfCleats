# Test Runner Profile Artifacts

The test runner emits `profile.json` when `node tests/run.js --profile[=<path>]` is enabled.

Contract highlights:

- Versioned payload: `schemaVersion: 1`
- Normalized path policy: `repo-relative-posix`
- Fixed time unit: `ms`
- Deterministic test-row ordering by `id`
- Deterministic numeric rounding for duration fields (3 decimals)

Canonical schema and validation live in:

- `src/contracts/schemas/test-artifacts.js` (`testProfile`)
- `src/contracts/validators/test-artifacts.js` (`validateTestProfileArtifact`)
