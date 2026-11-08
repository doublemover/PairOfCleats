# Generation selection and SQLite ownership — 2026-10-27

Source candidate: `ee01bb7fce9c360d1c91e3e61b4979d1b26237d5`, tree
`c40a260ae671014186e58df1dd4b2fbfe7caaf01`, on
`codex/pr557-audit-repairs-20261012`. Implementation commits:
`1934f2738827f6e94a1532f699ba689e98edfa6f` and the candidate above.
Windows x64, Node 26.12.1; existing prepared dependencies, patches and native
binaries are unchanged. This batch did not rerun bootstrap.

## Delivered

Validation captures one pointer read, its SHA-256 and per-mode generation/index
and backend paths before asynchronous reads. Artifacts, SQLite metadata parity,
LMDB/SQLite reports and generation-local ordering ledgers use that selection.
Moving current cannot mix A's metadata with B's database or relabel the receipt.
Private capture identity rejects serialized/forged receipts and ignores mutated
display fields. Explicit roots retain precedence; only a captured legacy source
can use local fallback. Invalid selection cannot trigger another-generation read.
Requested strict ordering fails when its selected ledger or stage is missing.

SQLite resolves explicit per-mode inputs before requiring unrelated current
roots. Detached inputs require an explicit output. Historical selectors combined
with explicit inputs reject with a truthful conflict message. Selected manifest,
mode and generation identities are checked before target mutation. Source,
output and generation-state authority are separate: detached, historical and
external outputs cannot update input readiness, heartbeat, phase, checkpoints or
zero-state proof. Detached empty inputs create actual empty databases. An unknown
count uses the decoder's existing independent input count without another read;
a declared zero still rejects nonempty input before replacing a prior database.

Native reports capture original close owners before querying. LMDB completion
waits for both its result and original callback. SQLite uses the existing close
owner. Primary and cleanup causes remain reachable. Deferred manifest validation
propagates unsettled descriptor ownership and shares a terminal finalization
promise: close-only recovery cannot turn a failed invocation into success.

## Qualification

**34/34 affected cases and the complete front gate pass**, including **40/40
gate cases**. Format, config budget, environment audit, generated freshness,
command surface, workflow contract and diff checks pass. One job/thread,
30-second per-case deadlines, zero retries/native redo; no failures, timeouts,
skips or native crashes. Optional missing-family warnings are asserted explicitly.
The [structured receipt](generation-selection-repairs-2026-10-27.json) lists every
case and command. These checks bind the source candidate above; later tracking
changes do not constitute another runtime campaign.

Seven child-only prior-owner controls fail against
`53604a58ba08f8aa37da3a41bbe8a8384ed51279`: explicit input without current,
publication during validation, missing requested ledger, unknown input count,
external-output input-state mutation, premature LMDB completion and swallowed
manifest-close refusal. The checkout was never reverted. Real native SQLite and
LMDB handles and actual checksum descriptors are exercised. The native prefetch
runs normally; only its completion handoff is held to keep outstanding work live.

Existing active-generation, mixed published-root, shared-output refusal, same-run
stage4 pointer, build-truth ledger, SQLite row/zero-state and finding ownership
checks remain passing. New fixtures supply canonical timestamps, metadata schema,
SQLite IDs/metaV2 and semantic families. Older finding fixtures now publish their
synthetic diagnostic through the canonical owner and use the existing test-only
backend overlay. Their ordering, content, mode-isolation and failure assertions
remain intact; configuration schemas and public option budgets are unchanged.

## Tracking and scope

**#347 is closed completed**, with its original history preserved and closure
read back from GitHub. #1574 remains open for custom backend root/launch authority,
remaining modern reader/cache/builder/sidecar lifetimes and category/multi-repo
cleanup adoption. The live census agrees with the owner queue: **719 open**,
comprising 459 qualification pending, 147 partial/follow-up and 113 unresolved
implementation-status entries; 51 of the original 770 are closed.

Full deep-suite, representative performance, optional sqlite-vec, real-model and
release acceptance remain separate. No Linux/macOS, WSL, elevation, GUI launch,
physical symlink/junction creation or debugger registration was performed. The
physical-link aggregate fixtures `indexing/validate/index-contract-matrix` and
`indexing/validate/index-current-build-pointer-case-insensitive` were outside this
bounded cohort and are not counted as passes.

Raw `.tmp/tasks/generation-selection-20261027/` and `.testLogs/` references are
historical author-workspace evidence; clean checkouts do not contain them. This
receipt does not replace the separate debugger-attributed parser crash evidence
or qualify every native runtime lifecycle.
