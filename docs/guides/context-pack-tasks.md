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

CLI projection uses `--task`, `--granularity` and `--wholeFileFallback` once those
options are admitted by the central CLI surface. This policy does not add a target
tokenizer or claim better edit outcomes. Function boundary qualification, runtime
surface acceptance and production-corpus/patch-application comparisons remain
unqualified until their dedicated supported-runtime runs.
