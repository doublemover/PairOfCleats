import { assertSemanticEnvelope } from '../../contracts/validators/semantic-envelopes.js';
import { canonicalSemanticJson } from '../semantic/identity.js';
import { throwIfAborted } from '../../shared/abort.js';

const conflict = (kind) => Object.assign(new Error(`Conflicting provider ${kind} identity.`), {
  code: 'ERR_SEMANTIC_SOURCE_MISMATCH'
});

/** Combine one completed execution batch before the host changes durable selections. */
export const combineSemanticProviderOutputs = (outputs = []) => {
  const contexts = new Map(), partitions = new Map();
  const retain = (inventory, key, value, kind) => {
    canonicalSemanticJson(value);
    const previous = inventory.get(key);
    if (previous && canonicalSemanticJson(previous) !== canonicalSemanticJson(value)) throw conflict(kind);
    if (!previous) inventory.set(key, structuredClone(value));
  };
  for (const raw of outputs) {
    const output = assertSemanticEnvelope('provider', raw);
    if (output.coverageRef !== null || output.diagnosticsRef !== null) {
      throw Object.assign(new Error('Provider sidecar references require an admitted consumer.'), {
        code: 'ERR_TOOLING_UNSUPPORTED_OUTPUT'
      });
    }
    for (const context of output.contexts) retain(contexts, context.contextKey, context, 'context');
    for (const partition of output.partitions) retain(partitions, partition.partitionId, partition, 'partition');
  }
  return assertSemanticEnvelope('provider', {
    schemaVersion: 1,
    contexts: [...contexts.values()].sort((a, b) => a.contextKey.localeCompare(b.contextKey)),
    partitions: [...partitions.values()].sort((a, b) => a.partitionId.localeCompare(b.partitionId)),
    coverageRef: null, diagnosticsRef: null
  });
};

/** Host-owned dispatch separates emission from admission and persistence. A sink
 * is supplied by the build owner, never by an untrusted provider result. */
export const dispatchToolingProviderResult = async ({ result, semanticSink = null, signal = null }) => {
  throwIfAborted(signal);
  if (result?.semanticFacts !== undefined && !Array.isArray(result.semanticFacts)) throw Object.assign(new Error('Provider semantic result channel must be an array of canonical envelopes.'), {
    code: 'ERR_TOOLING_UNSUPPORTED_OUTPUT'
  });
  const outputs = Array.isArray(result?.semanticFacts) ? result.semanticFacts : [];
  const output = combineSemanticProviderOutputs(outputs);
  const emitted = outputs.reduce((count, value) => count + value.partitions.length, 0);
  const receipt = {
    schemaVersion: 1,
    presentation: { emitted: result?.byChunkUid instanceof Map ? result.byChunkUid.size : 0 },
    symbolicGraphs: { emitted: Array.isArray(result?.symbolicTypeGraphs) ? result.symbolicTypeGraphs.length : 0 },
    diagnostics: { providers: Object.keys(result?.diagnostics || {}).length },
    semantic: { emitted, unique: output.partitions.length, accepted: 0, persisted: 0,
      consumed: null, rejected: 0, unused: output.partitions.length,
      reason: output.partitions.length ? 'semantic_sink_unavailable' : 'no_semantic_output' }
  };
  if (output.partitions.length && typeof semanticSink === 'function') {
    const accepted = await semanticSink(output, { signal });
    throwIfAborted(signal);
    receipt.semantic.accepted = accepted.accepted;
    receipt.semantic.persisted = accepted.persisted;
    receipt.semantic.unused = 0;
    receipt.semantic.reason = 'semantic_sink_accepted';
  }
  return { semanticFacts: output, receipt };
};
