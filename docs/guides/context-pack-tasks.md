# Context-pack task policies

Context packs preserve their existing excerpt behavior when `taskPolicy` is
absent. API, MCP and direct tooling requests can opt into policy version 1:

```json
{
  "taskPolicy": {
    "schemaVersion": 1,
    "task": "edit-safe",
    "granularity": "file",
    "wholeFileFallback": false
  }
}
```

`edit-safe` admits a complete UTF-8 file or a qualified complete function. The source bytes must match
the selected index's retained full-file hash, and the index signature must be
available. The primary excerpt preserves the original BOM, tabs, spaces, line
endings and Unicode. `primary.unit` records the complete half-open UTF-16 span,
UTF-8 byte length, source hash, index signature and requested granularity. The
ordinary `strictEvidence` and type/semantic completeness contracts still apply.

Function requests parse the same verified full-file snapshot using the existing
JS/TS parser owners, including JSX/TSX dialects. An exact callable, export or
single-variable binding association is required. A retained definition range may
qualify a split fragment only when it exactly matches that parser association and
contains the fragment. A name or containing interval alone grants no boundary.
Malformed/recovered syntax, ambiguous associations and unsupported dialects return
`ERR_CONTEXT_PACK_UNIT_UNAVAILABLE` unless `wholeFileFallback` is explicitly true.
That fallback returns a complete verified file with `fallbackUsed: true`; it never
labels a clipped chunk as a complete function. Missing or ambiguous
source, missing hashes, unsupported encoding and outside-repository files also
produce explicit unavailable outcomes. Changed source returns
`ERR_CONTEXT_PACK_SOURCE_MISMATCH`; historical spans are never applied to changed
current source.

Complete files retain unit schema version 1. Complete functions use unit schema
version 2, recording parser family/version, original half-open UTF-16 span,
full-file source length/hash and a separate SHA-256 of the exact emitted unit.
Whitespace and line endings within that span are preserved. No new request flag
or policy version is required; default/exploration behavior remains unchanged.

The mandatory unit must fit the smaller of `maxBytes` and 128 KiB, as well as the
existing approximate whitespace token allowance when `maxTokens` is specified.
Failure returns `ERR_CONTEXT_PACK_UNIT_CANNOT_FIT`, without whitespace rewriting
or clipping. Final native and rendered JSON budgets still include metadata and
companions; an otherwise valid file may produce
`ERR_CONTEXT_PACK_RESPONSE_BUDGET` when the complete selected output cannot fit.
The existing `maxWallClockMs` cap is checked cooperatively around source admission
and assembly; expiry returns `ERR_CONTEXT_PACK_UNIT_DEADLINE`. Native operations
must settle before cancellation or deadline failures are reported.

Function qualification reads at most 1 MiB of source, traverses at most 100,000
AST nodes (also bounded by a supplied `maxWorkUnits`) and queues at most 10,000
nodes. A small function may fit inside a file larger than the response limit.
Source/traversal exhaustion is explicit unavailable qualification, not evidence
that a clipped unit is safe. Deadline/cancellation checks are cooperative around
the bounded synchronous parse and during traversal. Parser allocation and latency
still require measurement. Parsers load only for function requests. Intact-unit
source ranges never publish into shared excerpt/range caches.

`exploration` accepts `granularity: "excerpt"` and keeps the existing compact
excerpt behavior, including explicit truncation and incomplete evidence. It
cannot use whole-file fallback. Task policy participates in excerpt cache
identity. Edit requests reverify source and keep their derived graph/excerpt
caches local to the request, publishing no derived files into historical index
roots and no incomplete edit result into shared caches.

The central CLI admits `--task`, `--granularity` and `--wholeFileFallback`.
[Bounded evidence-set selection](context-evidence-selection.md) can add verified
intact optional units under an exact rendered budget. Its default remains absent.

[Exact rendered token budgeting](context-token-budget.md) is a separate opt-in
that preserves these intact units. Runtime function-boundary/surface
acceptance and production-corpus/patch-application comparisons remain
unqualified until their dedicated supported-runtime runs.

## Reviewed public option surface

The config inventory includes these four optional flags introduced by the task
policy and path-capability implementation. Its CLI budget was 77 (previously 73);
the separate exact-token option advances the current reviewed budget to 78.
Config-key and environment-variable budgets are unchanged. These flags add no
implicit edit authority, fallback or executable-path claim.

| Flag | Default | Purpose and admission |
| --- | --- | --- |
| `--task` | Absent | Select `edit-safe` or `exploration`; absent preserves existing excerpt behavior. |
| `--granularity` | Absent | Select `file`, `function` or `excerpt` within the task policy; unsupported/inconsistent combinations fail canonical validation. |
| `--wholeFileFallback` | False/absent | Explicitly permit a verified whole-file replacement for an unavailable complete function unit. |
| `--pathSemantics` | Absent | Opt into the operation's supported path declaration; graph context/impact accept `graph-witness`, while semantic trace retains its own canonical profiles. |

Coverage owners are `tests/context-pack/task-policy.test.js`,
`tests/context-pack/task-policy-surfaces.test.js`,
`tests/context-pack/complete-function-unit.test.js`,
`tests/graph/path-capability-publication.test.js`, and
`tests/storage/semantic/path-capabilities.test.js`. Config inventory checks
registered public flags against the reviewed list and fixed budget.
`PAIROFCLEATS_FUTURE_SECRET` is an inventoried synthetic test credential, not a
supported runtime setting; the environment-metadata fixture proves it is omitted
from persisted benchmark evidence. Installer capability fixtures use a local
`TEST_RENDERER_CAPABILITY` marker outside the project configuration namespace.
