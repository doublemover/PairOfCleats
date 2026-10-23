import path from 'node:path';
import crypto from 'node:crypto';
import { getBuildsRoot, getRepoCacheRoot } from '../../../shared/dict-utils.js';
import { assertNoSymlinkPath } from '../../../shared/contained-file.js';
import { stableStringifyForSignature } from '../../../shared/stable-json.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../contracts/versioning.js';
import { readBuildMetadata, verifyCompletedStage } from '../../../index/build/completed-stage.js';
import { resolveArtifactPublicationPath } from '../../../index/build/artifact-publication.js';
import { acquireIndexLock, readIndexLockInfo } from '../../../index/build/lock.js';
import { createIndexCacheLease, assertIndexCacheLease } from '../../../index/build/cache-lease.js';
import { releaseCacheWriterOwnership } from '../../../index/build/cache-writer-drain.js';
import { validateIndexArtifacts } from '../../../index/validate.js';
import { promoteBuild } from '../../../index/build/promotion.js';
import { createRuntimeAttempt } from '../../../shared/runtime-envelope/receipt.js';
import { persistRuntimeAttempt } from '../../../index/build/build-state/runtime.js';
import { throwIfAborted, isAbortError } from '../../../shared/abort.js';

const MODES = new Set(['code', 'prose', 'extracted-prose', 'records']);
const hash = value => crypto.createHash('sha256').update(stableStringifyForSignature(value)).digest('hex');
const fail = (code, message) => Object.assign(new Error(message), { code });
const samePath = (left, right) => path.relative(path.resolve(left), path.resolve(right)) === '';
const validRoot = (root, selected, userConfig) => {
  if (typeof selected !== 'string' || !selected.trim()) throw fail('ERR_RECOVERY_SELECTOR', 'Recovery requires an exact retained build root.');
  const buildRoot = path.resolve(selected), buildsRoot = path.resolve(getBuildsRoot(root, userConfig));
  if (!samePath(path.dirname(buildRoot), buildsRoot)) throw fail('ERR_RECOVERY_SELECTOR', 'Recovery root must be an immediate retained generation in the repository builds directory.');
  try { assertNoSymlinkPath(getRepoCacheRoot(root, userConfig), buildRoot); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw Object.assign(fail('ERR_RECOVERY_GENERATION_MISSING', 'The exact retained generation is absent; current/latest fallback is disabled.'), { cause: error });
  }
  return buildRoot;
};
const pointerIdentity = async (root, userConfig) => {
  try { return (await readBuildMetadata(getBuildsRoot(root, userConfig), path.join(getBuildsRoot(root, userConfig), 'current.json'), 512 * 1024)).hash; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};

/** Bounded metadata-only inspection: no lock acquisition, model initialization,
 * parser work or inferred fallback from an explicit missing generation.
 */
export const planBuildRecovery = async ({ root, userConfig, indexRoot, operation = 'validate', modes = null, signal = null }) => {
  throwIfAborted(signal);
  if (!['validate', 'publish'].includes(operation)) throw fail('ERR_RECOVERY_OPERATION', 'Supported recovery operations are validate and publish.');
  const buildRoot = validRoot(root, indexRoot, userConfig);
  const { value: state, hash: stateHash } = await readBuildMetadata(buildRoot, path.join(buildRoot, 'build_state.json'), 8 * 1024 * 1024);
  if (state?.artifactSurfaceVersion !== ARTIFACT_SURFACE_VERSION || state.schemaVersion !== 1
    || typeof state.buildId !== 'string' || !state.buildId
    || !samePath(state.buildRoot || '.', buildRoot) || !samePath(state.repoRoot || '.', root)) {
    throw fail('ERR_RECOVERY_GENERATION', 'Retained build metadata belongs to another repository or format.');
  }
  const selectedModes = modes || state.modes;
  if (!Array.isArray(selectedModes) || !selectedModes.length || selectedModes.length > 4
    || selectedModes.some(mode => !MODES.has(mode)) || new Set(selectedModes).size !== selectedModes.length) {
    throw fail('ERR_RECOVERY_MODES', 'Recovery requires explicit supported modes present in retained metadata.');
  }
  if (selectedModes.some(mode => !state.modes?.includes(mode))) throw fail('ERR_RECOVERY_MODES', 'Requested mode is absent from the selected generation.');
  const evidence = [];
  for (const mode of selectedModes) {
    throwIfAborted(signal);
    try {
      const { value: publication, hash: publicationHash } = await readBuildMetadata(buildRoot, resolveArtifactPublicationPath(buildRoot, mode));
      const completion = publication.completedStage;
      evidence.push({ mode, status: completion ? 'sealed-unverified' : 'unverified', publicationHash,
        completion: completion || null, reason: completion ? 'exact-bytes-revalidation-required' : 'completion-receipt-missing' });
    } catch (error) {
      if (!['ENOENT', 'ERR_FILE_TOO_LARGE'].includes(error.code) && !(error instanceof SyntaxError)) throw error;
      evidence.push({ mode, status: 'unverified', publicationHash: null, completion: null,
        reason: error.code === 'ENOENT' ? 'publication-record-missing' : 'publication-record-invalid' });
    }
  }
  const lock = await readIndexLockInfo(getRepoCacheRoot(root, userConfig));
  const plan = { schemaVersion: 1, operation, repoRoot: path.resolve(root), buildRoot, buildId: state.buildId,
    modes: selectedModes, stateHash, configIdentity: hash(userConfig), currentPointerIdentity: await pointerIdentity(root, userConfig),
    sourceScope: 'retained-historical-snapshot', sourceFreshness: 'not-checked-against-working-tree',
    modeEvidence: evidence, originalStage: state.stage || null, originalFailurePreserved: true,
    sourceConfigHash: state.configHash || null, repoProvenance: state.repo || null,
    work: { parseFiles: 0, generateEmbeddings: false, rebuildArtifacts: false,
      validateExistingBytes: true, publishCurrentPointer: operation === 'publish' },
    requiredDownloads: [], additionalArtifactBytes: 0,
    blocked: lock ? 'repository-writer-lease-present' : null,
    limitations: ['No working-tree refresh or missing-stage resume is authorized.',
      'Stage seals are exact-byte evidence; an independent immutable graph capability is unavailable.',
      'Publication requires every selected mode seal and normal validation under current validation policy.'] };
  return { ...plan, planId: hash(plan) };
};

/** Execute the reviewed transaction under the normal writer owner. Validation
 * never constructs a build runtime, so it cannot parse or initialize embeddings.
 */
export const executeBuildRecovery = async ({ root, userConfig, plan, signal = null, log = () => {} }) => {
  if (!plan?.planId) throw fail('ERR_RECOVERY_PLAN', 'A reviewed recovery plan is required.');
  const currentPlan = await planBuildRecovery({ root, userConfig, indexRoot: plan.buildRoot,
    operation: plan.operation, modes: plan.modes, signal });
  if (currentPlan.planId !== plan.planId || hash(Object.fromEntries(Object.entries(plan).filter(([key]) => key !== 'planId'))) !== plan.planId) {
    throw fail('ERR_RECOVERY_PLAN_STALE', 'Recovery plan changed; inspect the exact generation again.');
  }
  if (currentPlan.blocked) throw fail('ERR_RECOVERY_BUSY', 'Repository writer lease is present; recovery did not mutate the generation.');
  const repoCacheRoot = getRepoCacheRoot(root, userConfig);
  const lock = await acquireIndexLock({ repoCacheRoot, signal, requireSettlement: true,
    storageContext: { repoRoot: root, userConfig }, metadata: { owner: 'build-recovery', operation: plan.operation }, log });
  if (!lock) throw fail('ERR_RECOVERY_BUSY', 'Repository writer lease is unavailable.');
  let lease = null, operationError = null, attempt = null, published = false;
  try {
    lease = createIndexCacheLease(lock, repoCacheRoot);
    // Recheck after admission, without treating our own newly acquired lock as a stale plan.
    const admitted = await planBuildRecovery({ root, userConfig, indexRoot: plan.buildRoot, operation: plan.operation, modes: plan.modes, signal });
    const { blocked: _blocked, planId: _planId, ...admittedContent } = admitted;
    if (hash({ ...admittedContent, blocked: plan.blocked }) !== plan.planId) throw fail('ERR_RECOVERY_PLAN_STALE', 'Recovery evidence changed during writer admission.');
    if (plan.operation === 'publish') for (const mode of plan.modes) {
      await verifyCompletedStage({ buildRoot: plan.buildRoot, buildId: plan.buildId, repoRoot: root, mode, signal });
    }
    attempt = await createRuntimeAttempt({ buildId: plan.buildId, stage: `recovery-${plan.operation}`,
      inputs: { recoveryPlanId: plan.planId, sourceScope: plan.sourceScope, modes: plan.modes },
      embeddings: { observation: { state: 'not-run', provider: null, dims: null, observedAt: null } } });
    await persistRuntimeAttempt(plan.buildRoot, attempt, { lifecycle: 'running' });
    const validation = await validateIndexArtifacts({ root, indexRoot: plan.buildRoot, userConfig, modes: plan.modes,
      sqliteEnabled: userConfig.sqlite?.use !== false, strict: true, abortSignal: signal });
    if (!validation.ok) throw Object.assign(fail('ERR_RECOVERY_VALIDATION', 'Retained generation failed required validation; pointer preserved.'), { validation });
    throwIfAborted(signal);
    assertIndexCacheLease(lease, repoCacheRoot);
    if (plan.operation === 'publish') {
      await promoteBuild({ repoRoot: root, userConfig, buildRoot: plan.buildRoot, buildId: plan.buildId,
        stage: plan.originalStage, modes: plan.modes, configHash: plan.sourceConfigHash,
        repoProvenance: plan.repoProvenance, abortSignal: signal, expectedCurrentPointerHash: plan.currentPointerIdentity });
      published = true;
    }
    const result = { modes: plan.modes, repo: root, stage: `recovery-${plan.operation}`, buildId: plan.buildId,
      buildRoot: plan.buildRoot, runtimeAttemptId: attempt.attemptId, recoveryPlanId: plan.planId,
      sourceScope: plan.sourceScope, work: { parsedFiles: 0, embeddedFiles: 0, rebuiltArtifacts: 0 },
      validation: { status: 'passed' }, publication: { status: published ? 'published' : 'retained' },
      originalFailurePreserved: true };
    await persistRuntimeAttempt(plan.buildRoot, attempt, { lifecycle: 'succeeded', runtime: { recovery: result.work } });
    return result;
  } catch (error) {
    operationError = error;
    if (published || error?.publication?.status === 'published') {
      operationError = Object.assign(new Error('Generation published; recovery bookkeeping failed.', { cause: error }),
        { code: 'ERR_RECOVERY_POST_COMMIT', publication: { status: 'published', buildId: plan.buildId } });
    } else if (attempt) {
      try { await persistRuntimeAttempt(plan.buildRoot, attempt, { lifecycle: isAbortError(error) ? 'aborted' : 'failed',
        error: { code: String(error?.code || 'UNKNOWN'), message: 'Retained recovery did not publish.' } }); }
      catch (recordingError) { operationError = new AggregateError([error, recordingError], 'Recovery and durable failure recording failed.', { cause: error }); }
    }
    throw operationError;
  } finally {
    await releaseCacheWriterOwnership({ lease, release: () => lock.release(), operationError });
  }
};
