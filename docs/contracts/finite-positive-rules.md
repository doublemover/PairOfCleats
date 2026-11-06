# Finite positive-rule views

The bounded positive-rule kernel is a correctness baseline for support-aware view
maintenance and repair planning under #1516/#1524. It evaluates an explicitly
supplied finite Boolean Horn model. It does not extract program semantics, infer
causal direction or admit source/observation claims merely because coordinates or
generation metadata accompany them.

Definitions distinguish extensional facts from intensional rule heads. Rules have
unique identities and positive conjunctive bodies; arbitrary executable callbacks,
negative literals, undeclared references and rules that define extensional facts
are rejected. Empty bodies are declared model axioms. Recursive positive rules
use their least fixpoint; program dependency cycles are not erased or relabeled as
a causal DAG.

Extensional supports retain fact, origin and optional supplied source-reference
identity. Several supports for one true fact remain separate. The input envelope
is limited to 1 MiB, 128 facts, 256 rules, eight premises per rule and 1,024 support
records. Source coordinates remain supplied metadata, without current source
authority. The existing prepared occurrence-relation owner retains the bounded
direct-producer relation under its separate 8 MiB allowance.

Bootstrap materializes exact membership in the declared finite model. Every true
fact has one grounded witness whose dependency heights decrease. The complete
direct producer graph also retains other firing rules, including recursive edges;
it is not the set of all derivation paths or a count of independent observations.
The factor relation's unit is a direct producer/dependency occurrence, never a
proof multiplicity. Qualification fields keep these distinctions explicit.

`applyPositiveRuleSupportDelta` requires the original private handle and exact
base root. It removes only existing support identities, rejects duplicate/new
invalid supports and recomputes the complete declared model. Truth and producer
deltas are separate: unchanged membership cannot terminate support propagation.
Removing the last external seed retracts a recursive component rather than leaving
mutually supporting conclusions alive. Immutable older views remain inspectable.

Versioned identities bind the complete definition, canonical world and sorted
support records. Timing/work counters are separate from semantic identity. This
new supplied-model family does not change existing syntax/semantic producers or
invalidate unrelated source partitions. A future producer integration must bind
its model/version and admitted inputs in that producer's replay identity.

The strategy is full finite-model recomputation; no incremental latency or
sublinear-work claim is made. Fixpoint counters describe rule/body checks and
producer rows, not total capture/hash/encoding cost. Those phases need separate
measurement before optimization or production promotion.

Four unexecuted cases cover 256 small programs/EDB selections against an
independent all-closed-valuations oracle, producer-only changes, last-seed
recursive retraction, rebuild parity, immutable/uncopyable handles, strict input
contracts and cancellation. The `P←A; P←B` control keeps P true while changing its
producer before F1/F2 activate; the repair consumer must follow that changed
support rather than freeze P as an unexplained unchanged leaf.
