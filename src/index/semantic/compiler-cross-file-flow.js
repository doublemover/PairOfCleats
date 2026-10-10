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
    const partitionId = createAnalysisPartitionId({ pass: { name: 'compiler-call-flow', version: '3' }, inputPartitionHashes: hashes,
      compilerContext: { ...group.context, source: item.source.sourceUnitId }, dependencySummaryHashes: group.dependencyHashes,
      analysisPolicy: documents.map(value => ({ source: value.item.source.sourceUnitId, enrichment: (value.policy || policy).enrichment })).sort((a,b) => a.source.localeCompare(b.source)) });
    const evidence = { partitionId, localId: 0 }, rows = [{ family: 'node', row: { id: 0, kind: 'evidence', span: null, scope: null,
      data: { method: 'monotone-call-site-may-depend-summary', producerId: 'semantic-flow', producerVersion: '3', evidenceKind: 'static-analysis', sourceRef: item.source.sourceUnitId, artifactRef: null } } }];
    const edges = [], reasons = new Set(); let completed = 0, nextId = 1;
    const mode = effective.enrichment.crossFileFlow;
    const emit = (kind, from, to, call, ordinal = null) => edges.push({ kind, from, to, callSite: call.occurrence,
      operandOrdinal: ordinal, contextKey: group.context.contextKey, condition: null, evidence, certainty: 'modeled' });
    const valueFor = (origin, site, storage = null) => {
      const ref = { partitionId, localId: nextId++ };
      rows.push({ family: 'node', row: { id: ref.localId, kind: 'value', span: null, scope: null, data: { origin, site, storage } } });
      return ref;
    };
    const routes = new Map();
    for (const route of document.callEffects || []) {
      const key = canonicalSemanticJson(route.result);
      if (!routes.has(key)) routes.set(key, { reads: [], exceptionTargets: [] });
      const value = routes.get(key); value.reads.push(...route.reads); value.exceptionTargets.push(...route.exceptionTargets);
    }
    const aliases = new Map((document.aliases || []).map(value => [canonicalSemanticJson(value.ref), value]));
    let remainingEffectWork = 1000000;
    const same = (a,b) => canonicalSemanticJson(a) === canonicalSemanticJson(b);
    if (mode === 'off' || mode === 'deferred') reasons.add(mode === 'off' ? 'cross_file_flow_disabled' : 'cross_file_flow_deferred');
    else for (const call of [...calls].sort((a,b) => canonicalSemanticJson(a.occurrence).localeCompare(canonicalSemanticJson(b.occurrence)))) {
      throwIfAborted(signal);
      const result = call.result || call.occurrence, route = routes.get(canonicalSemanticJson(result));
      let summary = call.targets.length === 1 ? summaries.functions.get(canonicalSemanticJson(call.targets[0])) : null;
      if (call.targets.length !== 1) reasons.add('call_target_ambiguous_or_unresolved');
      else if (!summary) reasons.add('target_summary_unavailable');
      if (summary && (summary.async || summary.generator || call.invocationKind === 'construct')) {
        reasons.add('async_generator_or_constructor_result_model_required'); summary = null;
      }
      if (summary && !summary.complete) reasons.add('callee_local_flow_partial');
      if (summary?.widened) reasons.add('recursive_field_path_depth_widened');
      if (summary && !summary.converged) reasons.add('callee_recursive_summary_incomplete');
      if (summary?.returns.length) {
        // Only the established return channel crosses into the callee context.
        for (const returned of summary.returns) emit('returnToResult', returned, result, call);
        if (!call.hasSpread && effective.enrichment.callContextDepth > 0) {
          const value = valueFor('return', result);
          for (const ordinal of [...summary.dependencies].sort((a,b) => a-b)) {
            const argument = call.arguments?.[ordinal];
            if (argument) emit('flowsTo', argument, value, call, ordinal);
            else reasons.add('default_or_missing_argument_channel');
          }
          emit('flowsTo', value, result, call);
          for (const returned of summary.returns) emit('evidenceInput', returned, value, call);
        }
      } else if (summary) reasons.add('implicit_return_channel_unavailable');
      if (call.hasSpread) reasons.add('spread_runtime_parameter_position_unknown');
      if (effective.enrichment.callContextDepth === 0) reasons.add('context_insensitive_call_channels');
      if (summary && !call.hasSpread && effective.enrichment.callContextDepth > 0) {
        for (const effect of summary.effectDependencies.values()) {
          const argument = call.arguments?.[effect.parameter], alias = argument && aliases.get(canonicalSemanticJson(argument));
          if (!alias) { reasons.add('effect_argument_storage_mapping_unavailable'); continue; }
          const path = [...alias.path, ...effect.path];
          if (path.length > effective.enrichment.fieldPathDepth) { reasons.add('effect_field_path_depth_widened'); continue; }
          const value = valueFor('heap', result, alias.root);
          for (const ordinal of [...effect.dependencies].sort((a,b) => a-b)) if (call.arguments?.[ordinal]) emit('flowsTo', call.arguments[ordinal], value, call, ordinal);
          for (const ref of effect.refs) emit('evidenceInput', ref, value, call);
          if (!effect.dependencies.size) reasons.add('constant_effect_provenance_only');
          for (const read of route?.reads || []) {
            throwIfAborted(signal);
            if (--remainingEffectWork < 0) { reasons.add('call_effect_instantiation_budget'); break; }
            if (same(read.root, alias.root) && same(read.path, path)) emit('writes', value, read.ref, call);
          }
          reasons.add('call_field_effects_alias_accessor_and_order_conservative');
        }
      }
      // Unknown external/partial calls retain a call-owned unknown effect candidate.
      // These are may effects; no unique storage identity or runtime mutation is asserted.
      if ((!summary || !summary.complete || call.hasSpread) && route?.reads.length) {
        const unknown = valueFor('unknown', result);
        for (let ordinal = 0; ordinal < (call.arguments || []).length; ordinal++) emit('flowsTo', call.arguments[ordinal], unknown, call, ordinal);
        for (const read of route.reads) {
          if (--remainingEffectWork < 0) { reasons.add('call_effect_instantiation_budget'); break; }
          emit('writes', unknown, read.ref, call);
        }
        reasons.add('unknown_call_heap_effects_may_reach_following_fields');
      }
      if (route?.exceptionTargets.length) {
        const exception = valueFor('unknown', result);
        const dependencies = summary && !call.hasSpread ? summary.exceptionDependencies : new Set((call.arguments || []).map((_,ordinal) => ordinal));
        for (const ordinal of [...dependencies].sort((a,b) => a-b)) if (call.arguments?.[ordinal]) emit('flowsTo', call.arguments[ordinal], exception, call, ordinal);
        for (const target of route.exceptionTargets) emit('throws', exception, target, call);
        for (const ref of summary?.exceptions || []) emit('evidenceInput', ref, exception, call);
        reasons.add('call_exception_payload_and_delivery_modeled');
      }
      if (summary) completed += 1;
    }
    if (!summaries.converged && !['off', 'deferred'].includes(mode)) reasons.add('call_summary_iteration_or_work_budget');
    // May dependencies do not prove execution, alias uniqueness, or exception delivery.
    if (completed) reasons.add('call_owned_return_field_exception_may_summary');
    const uniqueEdges = [...new Map(edges.map(edge => [canonicalSemanticJson(edge), edge])).values()];
    uniqueEdges.sort((a,b) => canonicalSemanticJson(a).localeCompare(canonicalSemanticJson(b)));
    uniqueEdges.forEach((row,id) => rows.push({ family: 'edge', row: { id, ...row } }));
    const coverage = { scope: { sourceUnitId: item.source.sourceUnitId }, phase: 'crossFileFlow',
      state: mode === 'off' ? 'disabled' : mode === 'deferred' ? 'deferred' : reasons.size ? 'partial' : 'complete',
      reason: reasons.size ? [...reasons].sort().join(';') : null, observedCount: calls.length, completedCount: completed, frontierRef: null };
    rows.push({ family: 'coverage', row: coverage });
    const partition = await writeSemanticAnalysis({ rows, policy: effective, stagingRoot: item.root, source: item.source, sourceBytes: bytes, partitionId,
      producerHash: semanticHash('semantic.call-flow-producer.v1', { version: 3 }), contextHash: group.context.contextKey,
      policyHash: semanticHash('semantic.call-flow-policy.v1', effective.enrichment), diskAccount: state.semanticDiskAccount, signal });
    const current = state.semanticFactsByFile.get(item.file);
    state.semanticFactsByFile.set(item.file, createSemanticFactsRef({ source: item.source, storage: current.storage, syntaxPartitionId: current.syntaxPartitionId,
      partitions: [...current.partitions.filter(value => value.partitionId !== partitionId), partition], coverage: [...current.coverage.filter(value => value.phase !== 'crossFileFlow'), coverage] }));
    output.push(partition);
  }
  return output;
};
