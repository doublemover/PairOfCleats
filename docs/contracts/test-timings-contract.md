# Test Timings Contract

## Artifact

`tests/run.js` emits a timings artifact when `--timings-file <path>` is provided.

Schema contract:

- `schemaVersion: 1`
- `generatedAt: <iso8601>`
- `runId: <string>`
- `totalMs: <number>`
- `pathPolicy: "repo-relative-posix"`
- `timeUnit: "ms"`
- `watchdog: { triggered, reason }`
- `tests[]: { id, path, lane, status, durationMs }`

Rows are sorted by test id and path fields are normalized to repo-relative POSIX form.

## Validation

Timings artifacts are validated by:

- `src/contracts/schemas/test-artifacts.js` (`testTimings`)
- `src/contracts/validators/test-artifacts.js` (`validateTestTimingsArtifact`)
