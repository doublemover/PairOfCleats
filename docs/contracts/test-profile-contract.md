# Test Profile Contract

## Artifact

`tests/run.js` emits a profile artifact when `--profile` is enabled.

Default output path:

- `.testLogs/profile-<runId>.json`

Schema contract:

- `schemaVersion: 1`
- `generatedAt: <iso8601>`
- `runId: <string>`
- `pathPolicy: "repo-relative-posix"`
- `timeUnit: "ms"`
- `summary: { totalMs, tests, passed, failed, skipped, watchdogTriggered }`
- `tests[]: { id, path, lane, status, durationMs }`

Path fields are normalized to repo-relative POSIX form and entries are sorted by test id.

## Flag

- `--profile[=<path>]`: emit profile artifact

## Validation

Profile artifacts are validated by:

- `src/contracts/schemas/test-artifacts.js` (`testProfile`)
- `src/contracts/validators/test-artifacts.js` (`validateTestProfileArtifact`)
