import { SEMANTIC_ANALYSIS_VERSIONS, resolveCfgConstructionMaxBytes } from './analysis-versions.js';
import { createAnalysisPartitionId, semanticHash } from './identity.js';
import { writeSemanticAnalysis } from './analysis-write.js';
import { semanticConstructionAdmissionFor } from './planning.js';
import { nativeControlRows } from './native-control-rows.js';
import { createNativeFlowConstruction, NATIVE_FLOW_CONSTRUCTION_MAX_BYTES, NATIVE_FLOW_SHARED_CONSTRUCTION_BYTES } from './native-flow-construction.js';
import { throwIfAborted } from '../../shared/abort.js';
import { describeStorageFailure } from '../../shared/storage/failure-observation.js';

/** Structured statement CFG only. A pull producer owns bounded live frames and
 * one prepared row. The existing writer separately owns its bounded batch/queue;
 * construction leases never hold writer credits. Parser/source/anchor storage is
 * outside these logical allowances. No sealed prefix represents an incomplete
 * flow: a private construction stop aborts analysis staging before partial
 * coverage (unknown observation/frontier, zero completed count) is returned.
 */
export const collectNativeControlFlow = async ({ syntax, collector, partition, source, bytes, root, policy, diskAccount, signal }) => {
  const mode = policy.enrichment.localFlow;
  const coverage = { scope: { sourceUnitId: source.sourceUnitId }, phase: 'localFlow',
    state: mode === 'off' ? 'disabled' : 'unsupported', reason: mode === 'off' ? 'analysis_policy_disabled' : 'native_flow_requires_eager_admission',
    observedCount: null, completedCount: 0, frontierRef: null };
  if (mode !== 'eager' || !syntax?.tree || !collector.owners.length) return { coverage, partition: null };
  throwIfAborted(signal);
  const version = SEMANTIC_ANALYSIS_VERSIONS.nativeFlow;
  const partitionId = createAnalysisPartitionId({ pass: { name: 'native-structured-control', version },
    inputPartitionHashes: [partition.canonicalHash], compilerContext: null, dependencySummaryHashes: [], analysisPolicy: policy.identity.analysis });
  const maxBytes = Math.min(NATIVE_FLOW_CONSTRUCTION_MAX_BYTES, resolveCfgConstructionMaxBytes(policy));
  const construction = createNativeFlowConstruction({ maxBytes,
    maxRowBytes: Math.min(32768, policy.storage.batchBytes, policy.storage.maxQueuedBytes), signal });
  const admission = semanticConstructionAdmissionFor(diskAccount, NATIVE_FLOW_SHARED_CONSTRUCTION_BYTES);
  let release = null, result = null;
  try {
    release = await admission.acquire(maxBytes, { signal });
    const rows = nativeControlRows({ collector, partitionId, source, version, coverage, construction });
    result = await writeSemanticAnalysis({ rows, source, sourceBytes: bytes, stagingRoot: root, partitionId,
      producerHash: semanticHash('semantic.native-control-producer.v1', { version, language: source.language }),
      contextHash: null, policyHash: policy.identity.analysis, diskAccount, policy, signal });
  } catch (error) {
    if (!construction.isStop(error)) throw error;
    // Only this producer's private stop can degrade. Failed cleanup/resource
    // observations retain their original error and cannot become partial success.
    describeStorageFailure(error, { phase: 'native-flow-construction-stop' });
    Object.assign(coverage, { state: 'partial', reason: 'native_flow_construction_' + error.allowance.replaceAll('-', '_') + '_limit',
      observedCount: null, completedCount: 0, frontierRef: null });
  } finally { construction.dispose(); release?.(); }
  return { partition: result, coverage, construction: Object.freeze({ ...construction.stats }) };
};
