# Triage Records + Context Packs

## Overview
Triage records store vulnerability findings and decisions outside the repo (in the cache). Records are indexed separately and searched with metadata-first filters. Context packs bundle a finding, related history, and repo evidence for LLM workflows.

## Record defaults

Triage tools use the repository cache's `triage/records` directory. Raw-payload
retention is off by default; context packs use up to five history entries and
five evidence results per query.

The current repository configuration schema does not expose a top-level `triage`
namespace. Do not add `triage.*` to `.pairofcleats.json`: the config loader rejects
it before running the tool. Internal getter options and test-only overrides do
not establish a supported user-facing configuration path.

Use the commands below with their documented CLI inputs and defaults. Consult
the [configuration reference](../config/contract.md) for the currently accepted
repository keys.

## Ingest findings
Dependabot:
```
node tools/triage/ingest.js --source dependabot --in dependabot.json --meta service=api --meta env=prod
```

AWS Inspector:
```
node tools/triage/ingest.js --source aws_inspector --in inspector.json --meta service=api --meta env=prod
```

Generic (already normalized schema):
```
node tools/triage/ingest.js --source generic --in record.json --meta service=api --meta env=prod
```

Inputs may be a single record, an array of records, or a named `alerts`, `findings`,
`records` or `items` wrapper. Arrays owned by a shaped record (references, CWE tags
or custom fields) stay part of that record. Legacy wrappers with one array remain
supported; ambiguous wrappers are rejected. Primitive record entries are reported
as per-entry errors and never written.

Prefer an explicit `recordId` or `stableKey`. Fallback IDs hash the complete raw
JSON serialization, including Unicode and suffixes, with field and array order
preserved. Reordering fields therefore changes a fallback ID; identical inputs
retain it. Fallback provenance remains lower trust. A conflicting persisted
record at a derived ID is preserved and reported as an error; normalization's
generated outer timestamps alone do not make a repeat import conflicting.

For generic records, vulnerability, package and asset attributes alone are not
unique finding keys. Without an explicit `recordId` or `stableKey`, the complete
raw payload owns the existing lower-trust fallback identity. Different affected
packages, manifests, assets or routes therefore remain distinct findings. An
explicit ID/key keeps its documented update semantics. Previously derived IDs
are not renamed automatically: retain an old `recordId` explicitly when updating
that exact finding, and reconcile its decision links from original source rather
than merging every record with the same CVE/package.

Generic routing preserves valid supplied `service`, `env`, `team`, `owner` and
`repo` strings, trimmed as with CLI metadata. Explicit valid `--meta` values take
precedence field by field. The invocation repository is only the default when
the record has no valid repository value; null scaffold fields cannot erase a
mixed array's individual routing. Invalid/blank routing values do not override
valid defaults or existing supplied routing.

Each ingest writes:
- `<repoCacheRoot>/triage/records/<recordId>.json`
- `<repoCacheRoot>/triage/records/<recordId>.md`

## Decisions
```
node tools/triage/decision.js --finding <recordId> --status accept --justification "..." --reviewer "..."
```

## Exposure metadata
You can attach environment exposure context to records (especially generic/manual):
- `internetExposed` (true/false)
- `publicEndpoint`
- `dataSensitivity`
- `businessCriticality`
- `compensatingControls`

These render in the record markdown and are included in context packs. You can pass them via record JSON or as `--meta` values (for example `--meta exposure.publicEndpoint=https://...` or `--meta internetExposed=true`).

## Build records index
```
pairofcleats index build --mode records --incremental
```

## Search records
```
pairofcleats search "CVE-2024-0001" --mode records --meta service=api --meta env=prod --json
```

Filters:
- `--meta key=value` (repeatable)
- `--meta key` (field exists)
- `--meta-json '{"service":"api","env":"prod"}'`
- `--file`, `--ext` (generic filters applied to records too)

## Context packs
```
node tools/triage/context-pack.js --record <recordId> --out context.json
```

The context pack includes:
- `finding` (normalized record)
- `history` (related decisions)
- `repoEvidence` (code/prose search hits)

Context packs assume code/prose indexes exist (`pairofcleats index build`) and the records index is built (`pairofcleats index build --mode records`).

History scanning uses four concurrent verified JSON reads and retains at most
`maxHistory` full candidates per route class. The previous route-first, score,
newest-timestamp and record-ID ordering remains; exact ties preserve directory
order even if reads finish out of order. A zero effective history budget avoids
directory scanning. Individual canonical JSON reads keep the existing 16 MiB
sidecar allowance. Names/queue bookkeeping and total scanned I/O remain O(N);
retained full candidate payloads are O(K), plus admitted reads and one transient
heap insertion. This is a source work bound, not measured RSS/latency evidence.

Read/parse failures produce an explicit incomplete-history warning, total failure
count and up to eight bounded diagnostic samples. They do not become evidence
that the history was exhaustively empty. Pending native ownership propagates
instead of becoming a warning. Missing selected findings remain distinct from
malformed/unreadable findings. These source changes and authored queue/heap/
default-reader controls are unvalidated; broader resource/quality and end-to-end
context-pack acceptance remain outstanding.

## MCP tools
- `triage_ingest` (wraps ingest)
- `triage_decision` (writes decisions)
- `triage_context_pack` (builds context packs)

These live alongside `search`/`build_index` and support records mode + metadata filters.

## Inspector packages, timestamps and records identity

AWS numeric observation timestamps are Unix seconds; fractional seconds and epoch zero are retained at millisecond precision. ISO/offset strings remain supported. Numeric strings, malformed values and out-of-range values produce diagnostics rather than a guessed unit. Reimport affected stored findings from source; historical 1970 dates cannot be repaired reliably without their original representation.

Inspector `packages` retains every valid affected occurrence, sorted by canonical package evidence, with deterministic occurrence IDs. Duplicate names at different file paths/layers remain associated with their own versions and fixes. `package` is a compatibility representative; it does not indicate collection completeness. Native `fixedInVersion` wins over a conflicting legacy `fixedVersion` and produces a diagnostic. Missing remediation remains unknown. Markdown, promoted package-name/ecosystem arrays and context-pack queries retain all packages; legacy singleton records remain readable. Reimport and rebuild old lossy records.

Inspector CVSS follows the official [score-array](https://docs.aws.amazon.com/inspector/v2/APIReference/API_PackageVulnerabilityDetails.html)
and [entry](https://docs.aws.amazon.com/inspector/v2/APIReference/API_CvssScore.html)
schemas: numeric `baseScore`, `scoringVector`, `source` and `version`. Valid zero
scores are retained. Malformed native entries are reported instead of coercing
null/boolean/string scores into numbers. The existing canonical `vuln.cvss`
remains one `{score, vector, version}` object. Its `max-base-score.v1` projection
selects greatest score, then greatest numeric major/minor version, then ascending
source/vector/version text. Array order never decides between different values.
Multiple valid native entries produce an explicit selection/source diagnostic;
original alternatives are retained only when existing raw-payload retention is
enabled. The canonical projection is not an exhaustive score collection. Legacy
object aliases remain supported, including finite numeric score strings and
partial vector/version data; invalid or missing scores are not invented zeroes.
Reimport affected Inspector findings to restore their previously missing CVSS.

Records incremental identity version 2 covers normalized source text, canonical JSON sidecar contents or explicit absence, discovery metadata and producer/promotion policies. JSON key reordering is a no-op; metadata-only reimports invalidate SQLite input identity. Malformed or unreadable sidecars fail before replacement rather than being treated as absence. Literal phrase evidence is produced from the ordered source with preserved case, independently of scoring tokenization.
