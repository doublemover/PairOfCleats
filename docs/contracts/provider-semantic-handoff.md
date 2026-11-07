# Provider semantic handoff

Implementation status: UNVALIDATED. The authored fixtures have not been executed.

`runToolingPass` returns canonical `semanticFacts` separately from legacy type presentation, symbolic type graphs and diagnostics. `result-dispatch.js` validates and combines a completed provider batch, retaining one copy of identical context/partition descriptors and rejecting conflicting identities. Sidecar references without an admitted consumer fail explicitly. A host can supply `semanticSink`; providers cannot select their own sink. An absent sink reports unused facts rather than counting emission as semantic enrichment.

The existing semantic merge is the durable selection boundary. It verifies all source/context joins and immutable partition identities, validates persisted rows and qualified references under the selected generation/root/repository namespace, then selects the complete batch. Syntax admission remains owned by the parser. Cancelled or rejected batches do not change the selected descriptors. Unselected immutable files can remain staging artifacts for the existing generation cleanup owner.

The host sink combines its build signal with the dispatcher's operation signal through the shared cancellation owner. Either authority can cancel admission; a live operation signal cannot replace an aborted build signal. Cancellation is checked before persisted validation and immediately before selection.

Built-in LSP sessions and registered producers use the same batch combiner. The compiler's existing session retains ownership of its compiler partitions; joining the combined provider output must happen once after durable admission. The native provider pass combines its session and registered results before one merge.

The consumption receipt distinguishes emitted descriptors, unique descriptors, admitted descriptors and newly selected persisted descriptors. `consumed: null` means the dispatcher has no query observation; it never invents a query-visible count. Whole-generation publication and publication validation remain required before claiming published query acceptance. The deterministic fixture `indexing/semantic/provider-result-durable-sink` authors persisted evidence hydration through the semantic detail service, duplicate-ingestion controls and source/conflict/cancellation rejection. It does not qualify a real external tool or published generation.

The #1597 source repair prepares additions by source and reference groups once
per completed operation. Resolved root, exact generation and repository namespace
qualify each group. Context membership uses exact source-unit/hash indexes. Each
changed group creates one artifact store, one qualified-reference inventory and
one existing bounded read scope. Generic count/range/reference/hash/source checks
and host provider restrictions share the same member-row traversal; there is no
second records/sources/coverage decode. Coverage is collected privately per
partition, then joined in original source/addition order despite bounded parallel
validation. A late bad group cannot select earlier successful groups.

The host captures passive owned output/current descriptors and context snapshots
before asynchronous reads. Original selected references and canonical content,
context identity and runtime roots are rechecked immediately before synchronous
selection. Concurrent replacement or in-place source mutation rejects the batch;
caller mutation of provider output cannot redefine captured inputs. No validation
proof, path-only cache or live reader survives into another operation.

Private admission limits aggregate input JSON to64MiB, prepared canonical keys/
coverage plus logical index-entry charges to32MiB, descriptor visits to262144 and
structural checkpoints to4000000. The existing bounded encoder admits remaining
bytes before expansion; coverage accumulation is also charged before retention.
The authoritative file coverage-row cap remains unchanged. Resource exhaustion
is explicit, never truncated successful admission. These are logical JSON/index
and work allowances, not total JavaScript heap/RSS. Internal nonenumerable work
receipts expose actual grouping, root/key preparation, membership and row visits;
the existing accepted/persisted/unchanged JSON envelope is unchanged.

New unrun controls use actual durable multi-source parts at N/2N/4N and shared/
distinct roots, instrument actual store preparation and member traversal, compare
full selected descriptors and coverage, and preserve idempotence. Late hash,
context, syntax, cross-group reference, namespace, cancellation and changed-state
negatives retain all prior selections. A separate privately tightened admission
fixture checks aggregate, index, descriptor and work limits without large inputs.
The original dispatch/detail/cancellation fixture is unchanged. No native tool,
large-corpus throughput or passing functional qualification is claimed.
