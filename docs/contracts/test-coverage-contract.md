# Test Coverage Contract

## Artifact

`tests/run.js` emits a coverage artifact when `--coverage` is enabled.

Default output path:

- `.c8/coverage-<runId>.json`

Schema contract:

- `schemaVersion: 1`
- `generatedAt: <iso8601>`
- `runId: <string>`
- `pathPolicy: "repo-relative-posix"`
- `kind: "v8-range-summary"`
- `summary: { files, coveredRanges, totalRanges }`
- `entries[]: { path, coveredRanges, totalRanges }`

Paths are normalized to repo-relative POSIX form and entries are sorted by path.

Merge semantics (`--coverage-merge`):

- Entry merge is cumulative by `path` (`coveredRanges += ...`, `totalRanges += ...`).
- Values are clamped per entry so `coveredRanges <= totalRanges` before aggregation.

## Flags

- `--coverage[=<path>]`: enable coverage capture and artifact write
- `--coverage-merge <file-or-dir>`: merge existing coverage artifacts before write
- `--coverage-changed`: filter coverage entries to files changed vs `HEAD`

## Validation

Coverage artifacts are validated by:

- `src/contracts/schemas/test-artifacts.js` (`testCoverage`)
- `src/contracts/validators/test-artifacts.js` (`validateTestCoverageArtifact`)
