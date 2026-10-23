import path from 'node:path';
import { assertIndexCacheLease } from './cache-lease.js';
import { readCompletedStage, verifyCompletedStage } from './completed-stage.js';
import { verifyStageSnapshot, restoreStageSnapshot } from './stage-snapshot.js';
import { readBuildMetadata, stageIdentityHash, STAGE_METADATA_MAX_BYTES } from './stage-output.js';
import { buildStageReusePolicy, observeStageProducer } from './stage-provenance.js';
import { buildDependencySignatures } from './indexer/signatures.js';
import { openPublishedSemanticStore } from '../../semantic/published-store.js';
import { verifyCompilerDependencyInventory } from '../semantic/compiler-dependencies.js';
import { verifyNativeTaskAuthority } from '../semantic/native-task-authority.js';
import { verifyWasmTaskAuthority } from '../semantic/wasm/task-authority.js';
import { assertSemanticTaskAuthority } from '../semantic/task-authority.js';
import { semanticHash } from '../semantic/identity.js';
import { throwIfAborted } from '../../shared/abort.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';

export const stageReuseMismatch = reason => Object.assign(new Error(`Retained Stage2 reuse refused: ${reason}.`),
  { code: 'ERR_RECOVERY_INPUT_CHANGED', reuseReason: reason });
const requireEqual = (before, after, reason) => {
  if (before === null || before === undefined || after === null || after === undefined
    || stageIdentityHash(before) !== stageIdentityHash(after)) throw stageReuseMismatch(reason);
};
const admissionInvalidation = error => error instanceof SyntaxError || ['ENOENT', 'ERR_FILE_TOO_LARGE',
  'ERR_FILE_INTEGRITY', 'ERR_FILE_CHANGED', 'ERR_COMPLETED_STAGE_INVALID', 'ERR_SEMANTIC_INTEGRITY',
  'ERR_SEMANTIC_GENERATION_MISMATCH', 'ERR_SEMANTIC_UNAVAILABLE', 'ERR_SEMANTIC_DEPENDENCY_UNSEALED',
  'ERR_SEMANTIC_NATIVE_UNSEALED', 'ERR_SEMANTIC_BINARY_AUTHORITY'].includes(error.code);

/** Reuse delegates compiler/native/binary closure checks to their existing
 * authority owners. Source equality alone cannot certify external dependencies.
 */
const verifyExternalDependencies = async ({ runtime, verified, signal }) => {
  if (!verified.manifest.pieces.some(piece => piece.name === 'semantic_manifest')) {
    if (runtime.toolingEnabled && runtime.typeInferenceCrossFileEnabled) throw stageReuseMismatch('external-analysis-authority-unavailable');
    return { tasks: 0, inventories: 0 };
  }
  const indexDir = path.join(verified.snapshotRoot, 'index-code');
  const { store, manifest } = await openPublishedSemanticStore({ indexDir, repoRoot: runtime.root, signal });
  return store.withReadScope(async () => {
    const sources = new Map(), tasks = new Map();
    for (const partition of manifest.partitions) {
      for await (const source of store.iterateRows(partition.partitionId, 'semantic_sources', { signal })) sources.set(source.sourceUnitId, source);
      for await (const task of store.iterateRows(partition.partitionId, 'semantic_frontier', { signal })) {
        if (tasks.has(task.taskId) && stageIdentityHash(tasks.get(task.taskId)) !== stageIdentityHash(task)) throw stageReuseMismatch('conflicting-external-task-authority');
        tasks.set(task.taskId, task);
      }
    }
    let inventories = 0;
    const verifiedInventories = new Set();
    for (const task of tasks.values()) {
      throwIfAborted(signal);
      const registration = manifest.frontierTargets?.find(part => part.path === task.targetsRef);
      if (!registration || registration.bytes > STAGE_METADATA_MAX_BYTES) throw stageReuseMismatch('external-task-inventory-missing');
      const { value: target } = await readBuildMetadata(path.join(indexDir, 'semantic'),
        path.join(indexDir, 'semantic', task.targetsRef), STAGE_METADATA_MAX_BYTES, signal);
      if (semanticHash('pairofcleats.semantic.binding-targets.v1', target) !== task.targetSetHash
      || stageIdentityHash(target.generation) !== stageIdentityHash(manifest.generation)) throw stageReuseMismatch('external-task-inventory-changed');
      assertSemanticTaskAuthority(task, target);
      const inventoryId = stageIdentityHash({ compiler: target.compilerInventory, native: target.nativeInventory, binary: target.binaryInventory });
      if (verifiedInventories.has(inventoryId)) continue;
      if (target.compilerInventory) await verifyCompilerDependencyInventory({ inventory: target.compilerInventory,
        repoRoot: runtime.root, toolingConfig: runtime.toolingConfig, signal });
      else if (target.nativeInventory) await verifyNativeTaskAuthority({ task, target, repoRoot: runtime.root,
        toolingConfig: runtime.toolingConfig, sources, store, signal });
      else if (target.binaryInventory) await verifyWasmTaskAuthority({ task, target, sources, store, signal });
      else throw stageReuseMismatch('external-task-authority-unavailable');
      verifiedInventories.add(inventoryId); inventories++;
    }
    if ((manifest.completedTasks || []).some(receipt => !tasks.has(receipt.taskId))) throw stageReuseMismatch('completed-analysis-task-authority-missing');
    return { tasks: tasks.size, inventories };
  });
};

/** Prepare all decisions before restoring any mode. Explicit historical resume
 * fails closed on changed source/policy/dependencies and never becomes refresh.
 */
export const prepareStageReuse = async ({ runtime, modes, plan, signal }) => {
  assertIndexCacheLease(runtime.cacheWriterLease, runtime.repoCacheRoot);
  if (stageIdentityHash(runtime.userConfig) !== plan.configIdentity) throw stageReuseMismatch('configuration-changed-during-runtime-admission');
  const producer = runtime.stageProducer || await observeStageProducer(signal);
  const reusable = new Map();
  const source = plan.modeEvidence.map(row => row.completion?.sourceSnapshot).find(value => value?.identity);
  requireEqual(source, runtime.buildSourceSnapshot, 'source-or-discovery-snapshot-changed');
  for (const mode of modes) {
    const evidence = plan.modeEvidence.find(row => row.mode === mode);
    if (!evidence?.completion) continue;
    const receipt = await readCompletedStage({ buildRoot: runtime.buildRoot, mode, signal });
    if (receipt?.schemaVersion !== 2 || receipt.reuseAuthority !== 'immutable-same-generation-stage2') throw stageReuseMismatch('immutable-stage-checkpoint-missing');
    if (receipt.sourceValidation?.status !== 'verified') throw stageReuseMismatch('actual-processed-source-identity-unavailable');
    requireEqual(evidence.completion, receipt, 'completed-stage-authority-changed');
    requireEqual(receipt.producer?.identity, producer.identity, 'implementation-or-bootstrap-identity-changed-or-unknown');
    requireEqual(receipt.reusePolicy, buildStageReusePolicy(runtime, mode), 'stage-content-or-semantic-policy-changed');
    requireEqual(receipt.sourceSnapshot, runtime.buildSourceSnapshot, 'source-or-discovery-snapshot-changed');
    requireEqual(receipt.dependencySignatures, buildDependencySignatures(runtime, mode, runtime.tokenizationKeys?.[mode]), 'stage-dependency-signatures-changed');
    let verified;
    try {
      await verifyCompletedStage({ buildRoot: runtime.buildRoot, buildId: runtime.buildId, repoRoot: runtime.root, mode, snapshot: true, signal });
      verified = await verifyStageSnapshot({ buildRoot: runtime.buildRoot, buildId: runtime.buildId,
        repoRoot: runtime.root, mode, locator: receipt.snapshot, signal });
    } catch (error) {
      observeStorageResource(error, { phase: 'stage-reuse-snapshot-admission' }).requireSettled();
      if (signal?.aborted || !admissionInvalidation(error)) throw error;
      throw Object.assign(stageReuseMismatch('immutable-stage-checkpoint-invalid'), { cause: error });
    }
    let dependencies = { tasks: 0, inventories: 0 };
    if (mode === 'code') {
      try { dependencies = await verifyExternalDependencies({ runtime, verified, signal }); }
      catch (error) {
        observeStorageResource(error, { phase: 'stage-reuse-dependency-admission' }).requireSettled();
        if (signal?.aborted || error.code === 'ERR_RECOVERY_INPUT_CHANGED' || !admissionInvalidation(error)) throw error;
        throw Object.assign(stageReuseMismatch('external-dependency-validation-failed'), { cause: error });
      }
    }
    reusable.set(mode, { receipt, dependencies });
  }
  return reusable;
};

export const restoreReusableStage = async ({ runtime, mode, reuse, signal }) => {
  const copied = await restoreStageSnapshot({ runtime, mode, receipt: reuse.receipt, signal });
  return { status: 'reused', reason: 'exact-source-policy-producer-and-dependency-authority', parsedFiles: 0,
    originatingAttemptId: reuse.receipt.originatingAttemptId, sourceBuildId: reuse.receipt.buildId,
    artifactPieces: reuse.receipt.output.pieces, artifactBytes: reuse.receipt.output.bytes,
    dependencies: reuse.dependencies, ...copied };
};
