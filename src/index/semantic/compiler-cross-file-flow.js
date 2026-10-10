import { createAnalysisPartitionId, semanticHash, canonicalSemanticJson } from './identity.js';
import { writeSemanticAnalysis } from './analysis-write.js';
import { createSemanticFactsRef } from './file-ref.js';
import { throwIfAborted } from '../../shared/abort.js';
import { buildCallDependencySummaries } from './compiler-call-summaries.js';
/** Call-site-owned may-depend channels; shared callee facts remain immutable. */
export const collectCompilerCrossFileFlow = async ({ group, state, policy, signal }) => {
  const documents = group.flowDocuments || [], output = [];
  const iterations = Math.max(0, ...documents.map(document => (document.policy || policy).enrichment.maxSccIterations));
  const activeDocuments = documents.filter(document => !['off', 'deferred'].includes((document.policy || policy).enrichment.crossFileFlow));
  const summaries = buildCallDependencySummaries(activeDocuments, { maxIterations: iterations, signal });
  const hashes = documents.map(document => document.partition.canonicalHash).sort();
  for (const document of documents) {
    throwIfAborted(signal);
    const effective = document.policy || policy, { item, bytes, calls } = document;
    const partitionId = createAnalysisPartitionId({ pass: { name: 'compiler-call-flow', version: '2' }, inputPartitionHashes: hashes,
      compilerContext: { ...group.context, source: item.source.sourceUnitId }, dependencySummaryHashes: group.dependencyHashes,
      analysisPolicy: documents.map(value => ({ source: value.item.source.sourceUnitId, enrichment: (value.policy || policy).enrichment })).sort((a,b) => a.source.localeCompare(b.source)) });
    const evidence = { partitionId, localId: 0 }, rows = [{ family: 'node', row: { id: 0, kind: 'evidence', span: null, scope: null,
      data: { method: 'monotone-call-site-may-depend-summary', producerId: 'semantic-flow', producerVersion: '2', evidenceKind: 'static-analysis', sourceRef: item.source.sourceUnitId, artifactRef: null } } }];
    const edges = [], reasons = new Set(); let completed = 0, nextId = 1;
    const mode = effective.enrichment.crossFileFlow;
    const emit = (kind, from, to, call, ordinal = null) => edges.push({ kind, from, to, callSite: call.occurrence,
      operandOrdinal: ordinal, contextKey: group.context.contextKey, condition: null, evidence, certainty: 'modeled' });
    if (mode === 'off' || mode === 'deferred') reasons.add(mode === 'off' ? 'cross_file_flow_disabled' : 'cross_file_flow_deferred');
    else for (const call of [...calls].sort((a,b) => canonicalSemanticJson(a.occurrence).localeCompare(canonicalSemanticJson(b.occurrence)))) {
      throwIfAborted(signal);
      if (call.targets.length !== 1) { reasons.add('call_target_ambiguous_or_unresolved'); continue; }
      const summary = summaries.functions.get(canonicalSemanticJson(call.targets[0]));
      if (!summary) { reasons.add('target_summary_unavailable'); continue; }
      if (summary.async || summary.generator || call.invocationKind === 'construct') { reasons.add('async_generator_or_constructor_result_model_required'); continue; }
      if (!summary.complete) reasons.add('callee_local_flow_partial');
      if (!summary.returns.length) { reasons.add('implicit_return_channel_unavailable'); continue; }
      const result = call.result || call.occurrence;
      // The return transition stays tagged with the invocation for balanced trace traversal.
      for (const returned of summary.returns) emit('returnToResult', returned, result, call);
      if (call.hasSpread) reasons.add('spread_runtime_parameter_position_unknown');
      else if (effective.enrichment.callContextDepth > 0) {
        const value = { partitionId, localId: nextId++ };
        rows.push({ family: 'node', row: { id: value.localId, kind: 'value', span: null, scope: null,
          data: { origin: 'return', site: result, storage: null } } });
        for (const ordinal of [...summary.dependencies].sort((a,b) => a-b)) {
          const argument = call.arguments?.[ordinal];
          if (argument) emit('flowsTo', argument, value, call, ordinal);
          else reasons.add('default_or_missing_argument_channel');
        }
        emit('flowsTo', value, result, call);
        for (const returned of summary.returns) emit('evidenceInput', returned, value, call);
      } else reasons.add('context_insensitive_call_channels');
      completed += 1;
    }
    if (!summaries.converged && !['off', 'deferred'].includes(mode)) reasons.add('call_summary_iteration_or_work_budget');
    // Heap effects, exceptional contracts and context-sensitive recursion are not proved by may-depend return summaries.
    if (completed) reasons.add('return_dependency_summary_only');
    edges.sort((a,b) => canonicalSemanticJson(a).localeCompare(canonicalSemanticJson(b)));
    edges.forEach((row,id) => rows.push({ family: 'edge', row: { id, ...row } }));
    const coverage = { scope: { sourceUnitId: item.source.sourceUnitId }, phase: 'crossFileFlow',
      state: mode === 'off' ? 'disabled' : mode === 'deferred' ? 'deferred' : reasons.size ? 'partial' : 'complete',
      reason: reasons.size ? [...reasons].sort().join(';') : null, observedCount: calls.length, completedCount: completed, frontierRef: null };
    rows.push({ family: 'coverage', row: coverage });
    const partition = await writeSemanticAnalysis({ rows, policy: effective, stagingRoot: item.root, source: item.source, sourceBytes: bytes, partitionId,
      producerHash: semanticHash('semantic.call-flow-producer.v1', { version: 2 }), contextHash: group.context.contextKey,
      policyHash: semanticHash('semantic.call-flow-policy.v1', effective.enrichment), diskAccount: state.semanticDiskAccount, signal });
    const current = state.semanticFactsByFile.get(item.file);
    state.semanticFactsByFile.set(item.file, createSemanticFactsRef({ source: item.source, storage: current.storage, syntaxPartitionId: current.syntaxPartitionId,
      partitions: [...current.partitions.filter(value => value.partitionId !== partitionId), partition], coverage: [...current.coverage.filter(value => value.phase !== 'crossFileFlow'), coverage] }));
    output.push(partition);
  }
  return output;
};
