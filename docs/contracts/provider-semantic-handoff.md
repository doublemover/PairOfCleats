# Provider semantic handoff

Implementation status: UNVALIDATED. The authored fixtures have not been executed.

`runToolingPass` returns canonical `semanticFacts` separately from legacy type presentation, symbolic type graphs and diagnostics. `result-dispatch.js` validates and combines a completed provider batch, retaining one copy of identical context/partition descriptors and rejecting conflicting identities. Sidecar references without an admitted consumer fail explicitly. A host can supply `semanticSink`; providers cannot select their own sink. An absent sink reports unused facts rather than counting emission as semantic enrichment.

The existing semantic merge is the durable selection boundary. It verifies all source/context joins and immutable partition identities, validates persisted rows and qualified references under the selected generation/root/repository namespace, then selects the complete batch. Syntax admission remains owned by the parser. Cancelled or rejected batches do not change the selected descriptors. Unselected immutable files can remain staging artifacts for the existing generation cleanup owner.

The host sink combines its build signal with the dispatcher's operation signal through the shared cancellation owner. Either authority can cancel admission; a live operation signal cannot replace an aborted build signal. Cancellation is checked before persisted validation and immediately before selection.

Built-in LSP sessions and registered producers use the same batch combiner. The compiler's existing session retains ownership of its compiler partitions; joining the combined provider output must happen once after durable admission. The native provider pass combines its session and registered results before one merge.

The consumption receipt distinguishes emitted descriptors, unique descriptors, admitted descriptors and newly selected persisted descriptors. `consumed: null` means the dispatcher has no query observation; it never invents a query-visible count. Whole-generation publication and publication validation remain required before claiming published query acceptance. The deterministic fixture `indexing/semantic/provider-result-durable-sink` authors persisted evidence hydration through the semantic detail service, duplicate-ingestion controls and source/conflict/cancellation rejection. It does not qualify a real external tool or published generation.
