# Native-language semantic implementation inventory

Checkpoint on local branch `codex/native-language-semantics-20261010`, based on
recovery head `144ab377a2b291a1e5db7dc2d4d47f786373c41d`. PR551 stays recovery-only;
publication of this branch needs destination approval. Original checkout/index
processes, dependencies and configuration were preserved.

## Implemented

- PR550 cache-reader assertion reconciliation (`e9cf9637a`): analysis policy changes
  invalidate derived facts, while immutable syntax reuse remains valid. Parser
  option changes still invalidate syntax. No cache production contract was relaxed.
- Python/C/Swift/Rust native grammar adapters use the existing runtime/parser pool
  and scheduler. Shared records retain source spans, symbols, references, calls and
  operands; parser/runtime/grammar versions enter cache identities.
- Structured local control is a separate versioned derived partition. Branches,
  loops and explicit return/throw/break/continue remain modeled, with explicit
  unsupported constructs and unknown compiler/runtime effects. Ownership preserves
  derived native partitions.
- Native-only eager provider work runs in the existing relations lane without a
  TypeScript Program or borrowed compiler lease. Existing LSP adapters now admit
  semantic-only targets; initial adaptive admission counts those targets too.
- Duplicate exact LSP locations no longer downgrade a resolved binding. Prepared
  documents use their retained source language. Python blocks do not invent lexical
  scopes. Disabled native parsers have distinct extraction identities.
- Four-language publication/retrieval fixtures cover cross-file target discovery,
  operands, ownership, trace witnesses and immutable-source context hydration.
- Adjacent recovery regression: `execution.maxAttempts: 0` was replaced by the
  default retry count by a truthy fallback in repository control-store opening.
  Nullish fallback preserves zero; the lifecycle fixture verifies no attempt or
  compiler callback occurs.

## Evidence and current validation

Node 26.8.1 and documented native readiness verification passed in the isolated
worktree; the worktree had already completed `bootstrap:ci`. Focused syntax, flow,
retrieval, LSP evidence and adaptive admission tests passed without retries.
Author-workspace `.testLogs` are historical local receipts, not clean-checkout inputs.

Live clangd 22.1.6 (LLVM commit `fc4aad7b5db3fff421df9a9637605b9ca5667881`), binary SHA256
`ad7fd474a36291377467966f920b350b4aa684b65e74623f8b8a38a9ced601f0`, produced one exact
cross-file call target from a C source to its retained header through production
provider orchestration, with zero legacy targets, background indexing disabled and
no fixture execution. Reproduce using `tests/tooling/lsp/native-clangd-semantic-smoke.mjs`
with an explicit installed clangd path. Earlier zero-target failure exposed the
initial adaptive-scope bug and passed after its fix.

Cold/warm four-file production indexing, exact canonical cache reuse and paginated
SQLite/artifact detail parity passed in 21.3 seconds. An earlier fixture compared
backend-specific response cursors; the corrected fixture drains bounded pages and
compares their actual retained evidence.

Thirteen focused cases pass across the native syntax/flow/retrieval/production
fixtures, cache-reader/analysis-version identity, binding lifecycle, embedded source,
LSP location evidence/adaptive scope, pyright planning, clangd missing-compilation
preflight and sourcekit package-preflight-not-needed. The lifecycle failure above
was fixed and rerun; no timed-out case or skip is counted as passing.

Final local gate passed: `npm run format`, `npm run config:budget`, `npm run env:check`,
generated-surface freshness, command-surface audit, workflow contracts, 39/39 gate
cases (35.7 seconds total, longest individual case 3.89 seconds), and `git diff --check`.
Historical local gate receipt: `.testLogs/run-1791677320752-odcno8`. There were no gate
failures, retries, timeouts or skips. Hosted CI is pending publication of this branch.

## Remaining scope

- Deferred/auto native provider tasks need sealed workspace/compiler authority and
  durable scheduling; this implementation admits only explicitly eager native work.
- Compiler-backed value/alias flow, cross-file argument/return propagation, exception
  precision, closures/macros/preprocessing, Rust borrow/drop/tail values, Python
  dynamic dispatch and Swift runtime effects are not claimed complete.
- Live pyright, sourcekit and rust-analyzer acceptance is unavailable on this host;
  location fixtures prove storage/query integration, not those compilers' behavior.
- JS/TS/WASM frontier/module/host-join work remains owned by the separate worker.
- No broad index, benchmark or release qualification was run. No push, new PR or
  merge is authorized for this language branch yet.
