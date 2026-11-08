# Original tokenizer invocation — 2026-10-28

Source `dc774685321113a497229383f45480ce6e99fd3f`, tree
`ff2e8eb9ce60e19c7bea7f9aa175beadb4af2f38`, branch
`codex/pr557-audit-repairs-20261012`. Unpublished; no runtime/performance acceptance.

The exact counter now has one invocation owner around its existing PQueue,
scheduler lease, contained profile inputs and original IndexerThreadPool. The
public context-pack path still counts one envelope; internal selection trials
can count at most 128 serial envelopes with the same verified profile and one
lazily initialized worker. A worker constructs its tokenizer once. Local scalar
scratch avoids repeating identical encodings without publishing incomplete
counts into the bounded cross-invocation cache. The complete invocation retains
the existing ten-second deadline and one-active/four-admitted bounds.

Accepted counts are joined even if a callback ignores them; discarded failures
remain invocation failures. Callback errors retain their own status/cause.
Cancellation begins the same original bounded destructor immediately, and
normal finalization joins it instead of starting another teardown. Unknown
original callbacks/resources remain retained; no inline fallback, native-status
retry or newly spawned replacement generation can qualify a failed invocation.
Early publication, retired operations, nesting and excess serial work reject.
Only actual completed invocation/worker exit admits reusable scalar publication.

The exact finalizer can reuse a captured count after JSON-only diagnostics change
only when the complete rendered string is byte-for-byte identical. It recomputes
the final payload identity and independently checks native/decorated CLI bytes.
Oversized rendered text fails the byte contract before counting; no estimated
sum or source clipping substitutes for an exact final count.

Nine authored cases cover worker/profile reuse, local/warm cache integrity,
retired invocation, ignored accepted work/failure, early publication, callback
failure, pre-cancellation, the 128-operation bound and nesting. Actual profile
initialization acknowledgement is asserted rather than inferred from a last log
line. All nine are unexecuted; the earlier twenty-five exact-budget/profile/
surface controls also require resulting-candidate qualification.

Static format/ESLint, changed JavaScript syntax, config budget, command inventory,
whitespace and zero-cycle analysis passed. No functional fixture, child fixture,
native campaign, benchmark or publication front gate ran. Dependency inputs are
unchanged from the successful locked bootstrap in the
[first exact-budget receipt](context-token-budget-implementation-2026-10-28.md).

#1125 remains qualification-pending. Cold/warm samples, serial p95 assembly and
original-owner/profile/surface acceptance remain. #1126 frozen candidate pooling,
bounded controls, canonical opt-in surfaces and evaluation remain separate source
work. Avoided repeated initialization is an implementation change, not a measured
latency or model-quality improvement.
