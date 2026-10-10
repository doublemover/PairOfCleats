import { createAnalysisPartitionId, semanticHash, canonicalSemanticJson } from './identity.js';
import { writeSemanticAnalysis } from './analysis-write.js';
import { createSemanticFactsRef } from './file-ref.js';
import { throwIfAborted } from '../../shared/abort.js';
/** Instantiate source-pinned function return channels at each resolved invocation. */
export const collectCompilerCrossFileFlow = async ({ group, state, policy, signal }) => {
  const documents = group.flowDocuments || [], summaries = new Map();
  for (const document of documents) for (const summary of document.summaries) if (summary.declaration) summaries.set(canonicalSemanticJson(summary.declaration), summary);
  const hashes = documents.map(document => document.partition.canonicalHash).sort(), output = [];
  for (const document of documents) {
    throwIfAborted(signal);
    const { item, bytes, calls } = document;
    const partitionId = createAnalysisPartitionId({ pass: { name: 'compiler-call-flow', version: '1' }, inputPartitionHashes: hashes,
      compilerContext: group.context, dependencySummaryHashes: group.dependencyHashes,
      analysisPolicy: { mode: policy.enrichment.crossFileFlow, callContextDepth: policy.enrichment.callContextDepth } });
    // Include the owning source so document outputs cannot share a logical partition.
    const ownedId = createAnalysisPartitionId({ pass: { name: 'compiler-call-flow-source', version: '1' }, inputPartitionHashes: [partitionId.slice(4)],
      compilerContext: { context: group.context.contextKey, source: item.source.sourceUnitId }, dependencySummaryHashes: [], analysisPolicy: {} });
    const evidence = { partitionId: ownedId, localId: 0 }, rows = [{ family: 'node', row: { id: 0, kind: 'evidence', span: null, scope: null,
      data: { method: 'resolved-call-return-channel', producerId: 'semantic-flow', producerVersion: '1', evidenceKind: 'static-analysis', sourceRef: item.source.sourceUnitId, artifactRef: null } } }];
    const edges = [], reasons = new Set(); let completed = 0;
    const mode = policy.enrichment.crossFileFlow;
    if (mode === 'off' || mode === 'deferred') reasons.add(mode === 'off' ? 'cross_file_flow_disabled' : 'cross_file_flow_deferred');
    else for (const call of calls) {
      if (call.targets.length !== 1) { reasons.add('call_target_ambiguous_or_unresolved'); continue; }
      const summary = summaries.get(canonicalSemanticJson(call.targets[0]));
      if (!summary) { reasons.add('target_summary_unavailable'); continue; }
      if (summary.async || summary.generator || call.invocationKind === 'construct') { reasons.add('async_generator_or_constructor_result_model_required'); continue; }
      if (!summary.complete) reasons.add('callee_local_flow_partial');
      if (!summary.returns.length) { reasons.add('implicit_return_channel_unavailable'); continue; }
      for (const result of summary.returns) edges.push({ kind: 'returnToResult', from: result, to: call.occurrence, callSite: call.occurrence,
        operandOrdinal: null, contextKey: group.context.contextKey, condition: null, evidence, certainty: 'modeled' });
      completed += 1;
    }
    // Shared callee channels are context-insensitive; callSite retains each instantiation.
    if (completed) reasons.add('context_insensitive_call_channels');
    edges.sort((a,b) => canonicalSemanticJson(a).localeCompare(canonicalSemanticJson(b)));
    edges.forEach((row,id) => rows.push({ family: 'edge', row: { id, ...row } }));
    const coverage = { scope: { sourceUnitId: item.source.sourceUnitId }, phase: 'crossFileFlow',
      state: mode === 'off' ? 'disabled' : mode === 'deferred' ? 'deferred' : reasons.size ? 'partial' : 'complete',
      reason: reasons.size ? [...reasons].sort().join(';') : null, observedCount: calls.length, completedCount: completed, frontierRef: null };
    rows.push({ family: 'coverage', row: coverage });
    const partition = await writeSemanticAnalysis({ rows, policy, stagingRoot: item.root, source: item.source, sourceBytes: bytes, partitionId: ownedId,
      producerHash: semanticHash('semantic.call-flow-producer.v1', { version: 1 }), contextHash: group.context.contextKey,
      policyHash: semanticHash('semantic.call-flow-policy.v1', policy.enrichment), diskAccount: state.semanticDiskAccount, signal });
    const current = state.semanticFactsByFile.get(item.file);
    state.semanticFactsByFile.set(item.file, createSemanticFactsRef({ source: item.source, storage: current.storage, syntaxPartitionId: current.syntaxPartitionId,
      partitions: [...current.partitions.filter(value => value.partitionId !== ownedId), partition], coverage: [...current.coverage.filter(value => value.phase !== 'crossFileFlow'), coverage] }));
    output.push(partition);
  }
  return output;
};
