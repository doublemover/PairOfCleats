# Triage Records + Context Packs

## Overview
Triage records store vulnerability findings and decisions outside the repo (in the cache). Records are indexed separately and searched with metadata-first filters. Context packs bundle a finding, related history, and repo evidence for LLM workflows.

## Record defaults

Repository records exclusions are terminal for records classification. Exclusion
wins over an include glob or content signal and prevents an extra record-sniff
read in initial preprocessing and watch routing. Normal prose/code eligibility
remains independent, and the dedicated triage records root retains its existing
explicit routing authority.

The triage Markdown inventory uses the shared bounded deterministic discovery
walker. A missing optional root is recorded separately from a successfully read
empty root. Directory errors, cancellation and disappearance after admission fail
the build before completed artifact publication or manifest pruning. The completed
inventory receipt appears under `index_state.extensions.recordsInventory`; it
describes enumeration, separately from source-byte admission. A changed source
that disappears during processing also fails instead of becoming a deletion.

Records ranges, chunk identity input and literal phrase tokens use original
decoded source text. Scoring tokens apply their own normalization; embedding
input uses an admitted document summary when present, otherwise original source
text. Producer version 8 and explicit source/embedding representation identities
invalidate older record products. Discovery selection version 3 and preprocessing
snapshot policy invalidate cached routing decisions.

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

Each ingest publishes `<repoCacheRoot>/triage/records/<recordId>.json` and returns
the selected immutable Markdown generation in `mdPath`. Use the returned path;
the producer no longer updates a second mutable `<recordId>.md` alias. The
canonical JSON selects a complete verified JSON/Markdown generation, so concurrent
imports or failed staging cannot mix indexed text with another record's metadata.
Exact reimports reuse the verified generation. Legacy Markdown inputs remain
readable. See the [publication contract](../contracts/triage-record-publication.md)
for retained generations, bounded reads and the versioned internal receipt.

## Decisions
```
node tools/triage/decision.js --finding <recordId> --status accept --justification "..." --reviewer "..."
```

The selected finding must have the requested `recordId`, `recordType: "finding"`
and a nonempty `source`. Selection reads at most 16 MiB through a contained,
descriptor-verified snapshot. ID-less, mismatched, malformed and unsupported
records fail before a decision is written; only actual absence is reported as
not found. History and selected context-pack records use the same admission.

Each new decision retains `decision.findingRecordId` and
`decision.findingObservation`: receipt version 1, record/source identity,
SHA-256 of the exact admitted bytes, byte count, observed timestamps and ID
provenance. Reimporting a finding under its stable ID does not retarget an older
decision's observation receipt. Existing decisions remain readable; their
missing receipt is unknown historical observation identity, not a verified link
to the newest finding. The receipt versions its own observation and retains
bounded known ID-provenance/timestamp fields. Source-specific record extension
fields are preserved; the receipt hash identifies the complete original bytes.

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
- `history` (exact finding decisions and related precedents)
- `historySelection` (relation, matched fields, historical validity and coverage)
- `repoEvidence` (code/prose search hits)

Context packs assume code/prose indexes exist (`pairofcleats index build`) and the records index is built (`pairofcleats index build --mode records`).

History reserves half the result allowance, rounded up, for decisions explicitly
linked to this finding. Related precedents retain route-first affinity ranking;
shared vulnerabilities or package names do not make them exact lineage. Unused
related slots can hold more exact decisions. Rows expose original finding links,
matched fields, route/observation drift and expiry at an explicit `asOf` time.
Conflicting decisions and authored reviewers remain history; none automatically
approves or suppresses the current finding.

The existing `maxHistory` selects up to 256 records; history plus its selection
envelope is capped at 1 MiB compact JSON. Omitted and oversized entries are
explicit. Scanning uses four concurrent verified reads with the existing 16 MiB
individual allowance. Three bounded candidate lanes retain at most 3 MiB of
charged wire/item data, plus one transient insertion and admitted reads. Names,
queue bookkeeping and compact snapshot digests remain O(N). These are work/data
bounds, not RSS or latency measurements. A zero history budget avoids scanning.

If `historySelection.continuationState` is `available`, its cursor retrieves the
next exact-history page within the same observed finding/record set and policy:

```powershell
$historyCursor = (Get-Content -LiteralPath 'context.json' -Raw | ConvertFrom-Json).historySelection.continuation | ConvertTo-Json -Compress -Depth 8
node tools/triage/context-pack.js --record <recordId> --repo <repo> --history-after $historyCursor --out context-next.json --no-ann
```

A changed finding, record set, scope or effective budget refuses the cursor;
start a fresh context pack. Each page makes one fresh scan with bounded read
concurrency. This cursor covers exact history; unavailable oversized records and
other omissions remain visible in the [selection contract](../contracts/triage-history-selection.md).

Read/parse failures produce an explicit incomplete-history warning, total failure
count and up to eight bounded diagnostic samples. They do not become evidence
that the history was exhaustively empty. Pending native ownership propagates
instead of becoming a warning. Missing selected findings remain distinct from
malformed/unreadable findings. These source changes and authored queue/heap/
default-reader controls are unvalidated; broader resource/quality and end-to-end
context-pack acceptance remain outstanding. New decision Markdown includes the
original finding ID; earlier immutable views retain their declared rendering.

## MCP tools

Records producer 9 uses canonical version 1 `recordSource` references. Each
reference binds the selected repository, configured repository/triage root,
source kind, relative path and original byte hash. The `.record-sources/v1/`
storage key namespaces **both** kinds; `displayPath` retains the familiar human
path. Two physical inputs named `triage/records/incident.md` remain distinct even
when their Markdown text is equal. Sidecar identity remains part of logical
content version 4 and producer-qualified replay. Chunk UIDs, hot/cold metadata,
file metadata, incremental manifests and SQLite retain the same source reference.

The inventory union prefers the configured triage authority for a file also
discovered inside the repository, yielding one actual source with its paired
sidecar. Conflicting duplicate source declarations fail explicitly. Source and
sidecar reads remain contained under the selected roots. Deferred embedding reads
select exactly one referenced root and verify original bytes before that file's
cache/provider work; a path prefix no longer grants fallback authority.

Rebuild existing records indexes to obtain the new identities. Existing published
records remain readable; ambiguous legacy `triage/records/` keys cannot be used
for deferred source rereads. Unprefixed legacy repository records remain eligible
for a contained reread when their original byte hash matches. Missing identity,
root changes and changed content require a rebuild. Row-budget trimming cannot
drop or truncate a new record source reference into an ordinary path; insufficient
allowance fails explicitly. No model or link creation is required for the new
source, publication and deferred-reader regression fixtures; execution is deferred.

Context packs carry `evidenceVersion` and a versioned `repoEvidence` projection.
Each query records the repository root actually passed to search, its CLI mode,
and `success`, `empty` or `unavailable` status. The shared retrieval selector maps
`extracted-prose` to `extractedProse`; missing/malformed selected arrays are
unavailable, with a query/mode-bound diagnostic and outer warning.

Evidence retains available canonical backend, fidelity, cache and selected-mode
freshness receipts, plus hit chunk/source identity and known/unknown ranges.
Absent upstream facts are explicit nulls. Root identity is a local search path,
not a globally stable repository ID. Saved previews are bounded, lossy display
text, not exact source support. Navigation remains `unavailable` until another
owner verifies repository, generation and source identity; this tool never reads
current same-path bytes as historical evidence. MCP returns the saved artifact
path together with its evidence version and searched-repository receipt.

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

Records logical-content identity version 4 covers normalized source text, canonical JSON sidecar contents or explicit absence, discovery metadata and producer/promotion policies. JSON key reordering is a no-op; metadata-only reimports invalidate SQLite input identity. Malformed or unreadable sidecars fail before replacement rather than being treated as absence. Literal phrase evidence is produced from the ordered source with preserved case, independently of scoring tokenization.
