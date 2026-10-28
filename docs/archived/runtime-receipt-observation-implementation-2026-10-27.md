# Runtime receipt write observations — 2026-10-27

**Unvalidated source:** `5cae80c13f1379da9125cdbabb70e564e182eba5`, tree
`7ad928881f2194a1f663d60bca6aa7ba728f94e6`, branch
`codex/pr557-audit-repairs-20261012`. Windows x64, Node 26.12.1.
Local implementation checkpoint; not pushed or functionally qualified.

The runtime-attempt writer previously wrapped a failed write without exposing its
pending resource observation. It also coerced diagnostic fields and could lose
the original failure if diagnostics or degraded-state projection threw. The
existing storage-observation owner now supplies a typed wrapping operation that
keeps the exact original cause, captured callback/receiver and independent
inspection prerequisites. Required callbacks are sealed against public report
replacement; captured context remains non-enumerable. This is diagnostic/resource
retention, not native close, metadata release or retry authority.

`persistRuntimeAttempt` retains its `ERR_RUNTIME_RECEIPT_PERSIST` contract and
captured attempt identity. Falsey/frozen native errors, pending false markers,
getter-owned failures and a frozen attempt cannot discard the actual write cause.
Unconfirmed work is not inspected for a diagnostic code. Code strings are bounded
without invoking arbitrary coercion.

The success boundary also observes the actual writer result before reading it.
It requires the admitted attempt/build/lifecycle/update in the existing state
reply; null, missing or mismatched acknowledgements cannot mark/announce the
attempt durable. This guards the internal acknowledgement, not physical-file
readback. Existing state/atomic owners still owe actual persistence.

Twelve **unexecuted** `indexing/runtime/receipt-persistence-observation/*` cases
cover confirmed acknowledgement, ordinary/frozen/falsey errors, captured attempt
identity, original callbacks/receivers/field mutation, independently pending
diagnostics, frozen degraded-state projection, unconfirmed output, pending
successful replies and result getter failures. They exercise the actual receipt
producer with an inert write adapter; no native file write, child or model is
claimed by these controls.

Static format/ESLint, changed JavaScript syntax, config budget, command inventory
generation and whitespace checks pass; shared-module analysis finds zero cycles.
Generated configuration inventory was refreshed. No functional fixture or
publication front gate ran. Actual build-state, runtime/category/teardown and
new acknowledgement/resource checks remain required on the resulting candidate.

## Next source work at the lower build-state owner

Source inspection finds additional work that this wrapper does not discharge:

- `store.js` typed write/lock wrappers and raw error-code branches can still lose
  pending observations or fail during diagnostics. Required writes can silently
  return after the root disappears.
- Concurrent sidecar/main writes are drained, but only the first rejection is
  retained. All independent failures must survive.
- `applyStatePatch` directly releases its coordinator in `finally`, including
  after unknown original work. It must use the existing actual file-lock release
  owner and expose that owner's recovery; no second lock/recovery engine is needed.
- The patch queue classifies raw diagnostics and schedules failed work again.
  Original unsettled work must block further native dispatch, including future
  coalesced patches; required failure versus best-effort retry policy needs
  explicit handling through this existing queue.

These production ownership gaps are next under #1574, ahead of performance work.
#1325 failed-recording qualification also depends on them. No lower-owner repair,
whole-store acceptance, issue closure or current-head runtime pass is claimed.
