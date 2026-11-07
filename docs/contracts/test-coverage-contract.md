# Test Coverage Contract

## Artifact

`tests/run.js` emits a coverage artifact when `--coverage` is enabled.

Default output path:

- `.tmp/dev/tests/coverage/coverage-<runId>.json`

Schema contract:

- `schemaVersion: 1`
- `generatedAt: <iso8601>`
- `runId: <string>`
- `pathPolicy: "repo-relative-posix"`
- `kind: "v8-range-summary"`
- `sourceIdentityVersion: 1`
- `sourcePlatform: <Node platform>`
- `summary: { files, coveredRanges, totalRanges }`
- `entries[]: { path, coveredRanges, totalRanges }`

Paths are repository-relative and entries are sorted by path. Only actual native
separators become `/`: a literal backslash in a POSIX filename remains filename
data. URL decoding precedes physical containment/relative-path admission. Summary
merging preserves admitted keys exactly and retains additive range totals.

Historical schema-1 artifacts without the source identity fields remain readable
as historical reports, but merging or qualifying them rejects with
`ERR_COVERAGE_SOURCE_IDENTITY`: lost physical filename identity cannot be recovered.
Those operations also reject a different source platform rather than reinterpreting
its filenames under the current filesystem. Fresh coverage captures emit both
identity fields; the artifact schema version and range accounting remain unchanged.

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
