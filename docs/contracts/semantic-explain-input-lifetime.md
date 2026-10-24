# Explain input and advisory reader lifetime

Status: UNVALIDATED source implementation and authored controls.

The existing explain runner captures the canonical explain request before validation
and generation/store callbacks. The direct service captures before tracing and uses
that same owned input for remaining work/byte allowances, generation checks, source
pins and plan/enqueue suggestions. A caller changing its nested generation, seed,
direction, kinds or limits while tracing cannot change the later projection. This
uses the schema-bounded immutable request owner described in
[semantic request capture](semantic-request-capture.md). Optional undefined data
properties retain omission semantics. Canonical explain request validation and
capture both carry the existing query-contract error code for transport400; result
validation failures retain their internal failure behavior.

The optional source/frontier deadline is advisory only after original resource
settlement. Its catch captures the original storage observation before checking
caller cancellation or an error's name, requires settlement before and after that
inspection, and retains independent falsey/pending inspection failures. An expired
deadline cannot turn an original descriptor-close failure into a partial response
or discard its recovery session. Settled ordinary timeout behavior is unchanged.
The existing descriptor/JSONL reader owner remains the only resource authority;
there is no implicit close retry, read replay or replacement session.

The authored fixture writes real semantic nodes and a canonical retained frontier,
then uses direct/public explain services to project source-pinned task proposals
while callbacks mutate the submitted request. It also injects actual original
FileHandle close faults into the retained source-header reader, waits for the
existing deadline, preserves pending closure through concurrent caller cancellation,
and recovers only original sessions without rereads. Diagnostic name getter and
ordinary settled timeout controls are included. None has been executed.

Manifest/store metadata retains its existing admission contract; request capture
does not snapshot arbitrary artifact inventories. Suggestions authorize no task,
enqueue, provider or publication action. Transport/session leases, abandoned
callbacks, native/provider/runtime/full-index and performance qualification remain
open. This repair changes no successful semantic producer, artifact or public
schema version and makes no broad closure or measured performance claim.
