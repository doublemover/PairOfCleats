# Original reranker adapter and score evidence

The retrieval consumer captures the original adapter callback and receiver,
string identifier and optional immutable identity/formatting strings, plus both
finite score bounds before launching asynchronous work. Later replacement of
those fields cannot alter the callback, result identity, admitted range or
published reranker name. This retains the existing original candidate membership,
source-generation snapshot, bounded pool/output caps and source-rank tie order.
It introduces no model selection, model pin, default quality or policy promotion.

Returned scoring evidence must be a dense original array of own passive rows.
Each row has exactly its own index and score data properties; inherited values,
accessors, additional symbol/nonenumerable fields, duplicate indices and missing
members are rejected. The consumer snapshots each validated primitive once. It
does not invoke an adapter's custom array iterator or row value getters to obtain
ranking evidence. Original descriptor/key inspection failures retain their exact
original error classification and independent pending ownership; fallback cannot
swallow pending native or diagnostic inspection work.

The diagnostic callback observes an already selected outcome after scoring and
adapter cleanup classification. Its original failure propagates independently;
it cannot rerun adapter work, trigger a second notification or relabel a scored
outcome as fallback. A returned original diagnostic promise is awaited, retaining
its rejection instead of silently dropping it. No-adapter passthrough preserves
the original output and does not adopt a previous output's diagnostic metadata.
If the selected fallback still has original adapter work pending, a diagnostic
failure retains that exact adapter, settlement and independent ownership along
with the diagnostic's original observation. Neither owner can release the other.
External diagnostic callback latency and cancellation are separate from the
bounded model-scoring window; no additional timeout or retry policy is added.

Actual consumer/admission/classification inert controls are authored but
**UNVALIDATED**. No tests, syntax/lint/format, bootstrap, model/native/child/IPC,
editor/browser/GPU, build or benchmark execution was performed. Model output
quality, native runtime acceptance, performance and artifact/license/revision
qualification remain separate requirements.
