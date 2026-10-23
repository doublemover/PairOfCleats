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

`edit-safe` admits one complete UTF-8 source file. The verified bytes must match
the selected index's retained full-file hash, and the index signature must be
available. The primary excerpt preserves the original BOM, tabs, spaces, line
endings and Unicode. `primary.unit` records the complete half-open UTF-16 span,
UTF-8 byte length, source hash, index signature and requested granularity. The
ordinary `strictEvidence` and type/semantic completeness contracts still apply.

Current chunk metadata does not prove that a function survived chunk splitting as
a complete unit. A `function` request therefore returns
`ERR_CONTEXT_PACK_UNIT_UNAVAILABLE` unless `wholeFileFallback` is explicitly true.
That fallback returns a complete verified file and records `fallbackUsed: true`;
it never labels a clipped chunk as a complete function. Missing or ambiguous
source, missing hashes, unsupported encoding and outside-repository files also
produce explicit unavailable outcomes. Changed source returns
`ERR_CONTEXT_PACK_SOURCE_MISMATCH`; historical spans are never applied to changed
current source.

The mandatory file must fit the smaller of `maxBytes` and 128 KiB, as well as the
existing approximate whitespace token allowance when `maxTokens` is specified.
Failure returns `ERR_CONTEXT_PACK_UNIT_CANNOT_FIT`, without whitespace rewriting
or clipping. Final native and rendered JSON budgets still include metadata and
companions; an otherwise valid file may produce
`ERR_CONTEXT_PACK_RESPONSE_BUDGET` when the complete selected output cannot fit.
The existing `maxWallClockMs` cap is checked cooperatively around source admission
and assembly; expiry returns `ERR_CONTEXT_PACK_UNIT_DEADLINE`. Native operations
must settle before cancellation or deadline failures are reported.

`exploration` accepts `granularity: "excerpt"` and keeps the existing compact
excerpt behavior, including explicit truncation and incomplete evidence. It
cannot use whole-file fallback. Task policy participates in excerpt cache
identity. Edit requests reverify source and keep their derived graph/excerpt
caches local to the request, publishing no derived files into historical index
roots and no incomplete edit result into shared caches.

The central CLI admits `--task`, `--granularity` and `--wholeFileFallback`. This policy does not add a target
tokenizer or claim better edit outcomes. Function boundary qualification, runtime
surface acceptance and production-corpus/patch-application comparisons remain
unqualified until their dedicated supported-runtime runs.

## Reviewed public option surface

The config inventory includes these four optional flags introduced by the task
policy and path-capability implementation. Its CLI budget is 77 (previously 73);
config-key and environment-variable budgets are unchanged. These flags add no
implicit edit authority, fallback or executable-path claim.

| Flag | Default | Purpose and admission |
| --- | --- | --- |
| `--task` | Absent | Select `edit-safe` or `exploration`; absent preserves existing excerpt behavior. |
| `--granularity` | Absent | Select `file`, `function` or `excerpt` within the task policy; unsupported/inconsistent combinations fail canonical validation. |
| `--wholeFileFallback` | False/absent | Explicitly permit a verified whole-file replacement for an unavailable complete function unit. |
| `--pathSemantics` | Absent | Opt into the operation's supported path declaration; graph context/impact accept `graph-witness`, while semantic trace retains its own canonical profiles. |

Coverage owners are `tests/context-pack/task-policy.test.js`,
`tests/context-pack/task-policy-surfaces.test.js`,
`tests/graph/path-capability-publication.test.js`, and
`tests/storage/semantic/path-capabilities.test.js`. Config inventory checks
registered public flags against the reviewed list and fixed budget.
`PAIROFCLEATS_FUTURE_SECRET` is an inventoried synthetic test credential, not a
supported runtime setting; the environment-metadata fixture proves it is omitted
from persisted benchmark evidence. Installer capability fixtures use a local
`TEST_RENDERER_CAPABILITY` marker outside the project configuration namespace.
