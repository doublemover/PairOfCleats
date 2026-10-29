import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';
import { atomicWriteJson } from '../../shared/io/atomic-write.js';
import { throwIfAborted } from '../../shared/abort.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';
import { loadJsonArrayArtifact } from '../../shared/artifact-io/loaders.js';
import { assertIndexCacheLease } from './cache-lease.js';
import { updateBuildState } from './build-state.js';
import { assertArtifactPublicationReady, resolveArtifactPublicationPath,
  resolveArtifactPublicationValidationPath } from './artifact-publication.js';
import { buildStageReusePolicy, observeStageProducer } from './stage-provenance.js';
import { snapshotStageOutput, verifyStageSnapshot } from './stage-snapshot.js';
import { inventoryStageOutput, inventoryStageOutputForCopy, readBuildMetadata, sameStagePath, stageFailure,
  stageIdentityHash, STAGE_METADATA_MAX_BYTES } from './stage-output.js';

export { readBuildMetadata } from './stage-output.js';

/** Existing state owns the seal so later mode publication replacement cannot
 * discard a complete earlier stage. Old publication extensions remain readable.
 */
export const readCompletedStage = async ({ buildRoot, mode, state = null, signal = null }) => {
  state ||= (await readBuildMetadata(buildRoot, path.join(buildRoot, 'build_state.json'), 8 * 1024 * 1024, signal)).value;
  if (state.completedStages?.[mode]) return state.completedStages[mode];
  return (await readBuildMetadata(buildRoot, resolveArtifactPublicationPath(buildRoot, mode), 1024 * 1024, signal)).value.completedStage || null;
};

/** Only drained, validated mode outputs get an immutable same-generation copy.
 * A graph receipt and a normal current pointer have independent authority.
 */
export const sealCompletedStage = async ({ runtime, mode, sourceSnapshot = null, dependencySignatures = null, signal = null }) => {
  const assertOwned = () => assertIndexCacheLease(runtime.cacheWriterLease, runtime.repoCacheRoot);
  assertOwned(); throwIfAborted(signal);
  await assertArtifactPublicationReady({ buildRoot: runtime.buildRoot, modes: [mode] });
  const filename = resolveArtifactPublicationPath(runtime.buildRoot, mode);
  const { value: publication, hash: publicationHash } = await readBuildMetadata(runtime.buildRoot, filename);
  const { value: validation, hash: validationHash } = await readBuildMetadata(runtime.buildRoot,
    resolveArtifactPublicationValidationPath(runtime.buildRoot, mode), STAGE_METADATA_MAX_BYTES, signal);
  if (validation.ok !== true || validation.mode !== mode || validation.buildId !== runtime.buildId
    || !sameStagePath(validation.buildRoot, runtime.buildRoot)
    || !sameStagePath(validation.indexDir, path.join(runtime.buildRoot, `index-${mode}`))
    || !Array.isArray(validation.families)) throw stageFailure('Required publication family validation is absent or belongs to another generation.');
  const { output, manifest, inventory } = await inventoryStageOutputForCopy({ buildRoot: runtime.buildRoot, buildId: runtime.buildId, mode, signal });
  let sourceValidation = { status: 'unavailable', reason: 'actual-processed-source-identity-unavailable' };
  if (runtime.preprocessedSources instanceof Map && manifest.pieces.some(piece => piece.name === 'file_meta')) {
    const rows = await loadJsonArrayArtifact(path.join(runtime.buildRoot, `index-${mode}`), 'file_meta', { manifest, strict: true });
    const names = new Set();
    const verified = rows.every(row => {
      const source = runtime.preprocessedSources.get(row.file);
      if (names.has(row.file)) return false;
      names.add(row.file);
      return source && typeof source.hash === 'string' && /^[a-f0-9]{40}$/.test(source.hash)
        && row.hashAlgo === 'sha1' && row.hash === source.hash && row.size === source.bytes;
    });
    if (verified && rows.length === runtime.sourceSelection?.modes?.[mode]?.selectedFiles) {
      sourceValidation = { status: 'verified', files: rows.length, algorithm: 'sha1',
        identity: stageIdentityHash(rows.map(row => ({ file: row.file, size: row.size, hash: row.hash, hashAlgo: row.hashAlgo }))),
        reason: 'actual-file-meta-matches-same-pass-preprocessing-hashes' };
    }
  }
  const observedProducer = await observeStageProducer(signal);
  const producer = runtime.stageProducer?.identity && runtime.stageProducer.identity !== observedProducer.identity
    ? { identity: null, reason: 'implementation-changed-during-stage' } : observedProducer;
  const completion = {
    schemaVersion: 2, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    stage: 'stage2', mode, buildId: runtime.buildId,
    buildRoot: path.resolve(runtime.buildRoot), repoRoot: path.resolve(runtime.root),
    originatingAttemptId: runtime.runtimeAttempt?.attemptId || null,
    sealedAt: new Date().toISOString(), configHash: runtime.configHash || null,
    profile: runtime.profile || null, sourceSnapshot, dependencySignatures,
    producer, reusePolicy: buildStageReusePolicy(runtime, mode), sourceValidation, output,
    publicationHash, validationHash, familyContractsVersion: validation.familyContractsVersion,
    publicationFamilies: validation.families.map(({ family, owner, requiredMembers, optionalMembers }) =>
      ({ family, owner, requiredMembers, optionalMembers })),
    reuseAuthority: 'immutable-same-generation-stage2'
  };
  const snapshot = await snapshotStageOutput({ runtime, mode, manifest, inventory, output, completion, signal });
  const completedStage = { ...completion, snapshot };
  assertOwned();
  await atomicWriteJson(filename, { ...publication, completedStage }, { spaces: 2, newline: true, signal, beforeCommit: assertOwned });
  await updateBuildState(runtime.buildRoot, { completedStages: { [mode]: completedStage } });
  return completedStage;
};

/** Inspect the immutable copy for reuse/graph reads; publication validation
 * explicitly rehashes the current mode, which optional stages may have changed.
 */
export const verifyCompletedStage = async ({ buildRoot, buildId, repoRoot, mode, signal = null, snapshot = false }) => {
  throwIfAborted(signal);
  const receipt = await readCompletedStage({ buildRoot, mode, signal });
  if (![1, 2].includes(receipt?.schemaVersion) || receipt.artifactSurfaceVersion !== ARTIFACT_SURFACE_VERSION
    || receipt.buildId !== buildId || receipt.mode !== mode || receipt.stage !== 'stage2'
    || !sameStagePath(receipt.buildRoot || '.', buildRoot) || !sameStagePath(receipt.repoRoot || '.', repoRoot)
    || !['exact-retained-bytes-only', 'immutable-same-generation-stage2'].includes(receipt.reuseAuthority)) {
    throw stageFailure('No valid exact-generation completion receipt.');
  }
  if (receipt.schemaVersion === 2) {
    const verified = await verifyStageSnapshot({ buildRoot, buildId, repoRoot, mode, locator: receipt.snapshot, signal });
    const { snapshot: _snapshot, ...sealed } = receipt;
    if (stageIdentityHash(verified.descriptor.completion) !== stageIdentityHash(sealed)) throw stageFailure('Stage receipt differs from its immutable descriptor.');
    if (snapshot) return receipt;
  } else if (snapshot) throw stageFailure('Historical mutable receipt has no immutable snapshot.');
  try { await assertArtifactPublicationReady({ buildRoot, modes: [mode] }); }
  catch (error) {
    if (error?.code !== 'ERR_ARTIFACT_PUBLICATION_INTEGRITY') throw error;
    const observation = observeStorageResource(error, { phase: 'completed-stage-publication-integrity' });
    const failure = stageFailure('Retained Stage2 publication differs from its exact generation seal.');
    failure.cause = error;
    throw observation.hasResourceObservation ? observation.wrap(failure) : failure;
  }
  const { output } = await inventoryStageOutput({ buildRoot, buildId, mode, signal, scope: 'stage2' });
  if (stageIdentityHash(output) !== stageIdentityHash(receipt.output)) throw stageFailure('Retained Stage2 content differs from its seal.');
  return receipt;
};
