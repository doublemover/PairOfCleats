import path from 'node:path';
import crypto from 'node:crypto';
import { getBuildsRoot, getRepoCacheRoot } from '../../../shared/dict-utils.js';
import { assertNoSymlinkPath } from '../../../shared/contained-file.js';
import { stableStringifyForSignature } from '../../../shared/stable-json.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../contracts/versioning.js';
import { readBuildMetadata, verifyCompletedStage } from '../../../index/build/completed-stage.js';
import { inventoryStageOutput } from '../../../index/build/stage-output.js';
import { readCompletedStage } from '../../../index/build/completed-stage.js';
import { updateBuildState } from '../../../index/build/build-state.js';
import { sealRetainedGraph, withRetainedGraph } from './recovery-graph.js';
import { createBuildRecoveryGrant, settleBuildRecoveryWriter } from './recovery-context.js';
import { durableRecoveryResult, summarizeRecoveryBackend, summarizeRecoveryModeWork } from './recovery-result.js';
import { resolveArtifactPublicationPath } from '../../../index/build/artifact-publication.js';
import { acquireIndexLock, readIndexLockInfo } from '../../../index/build/lock.js';
import { createIndexCacheLease, assertIndexCacheLease } from '../../../index/build/cache-lease.js';
import { validateIndexArtifacts } from '../../../index/validate.js';
import { promoteBuild } from '../../../index/build/promotion.js';
import { createRuntimeAttempt } from '../../../shared/runtime-envelope/receipt.js';
import { persistRuntimeAttempt } from '../../../index/build/build-state/runtime.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { addStorageFailureContext } from '../../../shared/storage/operation-error.js';
import { toRealPathSync } from '../../../workspace/identity.js';

const MODES = new Set(['code', 'prose', 'extracted-prose', 'records']);
const hash = value => crypto.createHash('sha256').update(stableStringifyForSignature(value)).digest('hex');
const fail = (code, message) => Object.assign(new Error(message), { code });
const samePath = (left, right) => path.relative(path.resolve(left), path.resolve(right)) === '';
const outputIdentities = async (plan, signal) => {
  const outputs = [];
  for (const mode of plan.modes) outputs.push({ mode, output: (await inventoryStageOutput({
    buildRoot: plan.buildRoot, buildId: plan.buildId, mode, signal })).output });
  return outputs;
};
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
const isCurrentGeneration = async (root, userConfig, buildRoot) => {
  let pointer;
  try { pointer = (await readBuildMetadata(getBuildsRoot(root, userConfig), path.join(getBuildsRoot(root, userConfig), 'current.json'), 512 * 1024)).value; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  return [pointer.buildRoot, ...Object.values(pointer.buildRootsByMode || pointer.buildRoots || {})]
    .some(value => typeof value === 'string' && samePath(path.resolve(getRepoCacheRoot(root, userConfig), value), buildRoot));
};

/** Bounded metadata-only inspection: no lock acquisition, model initialization,
 * parser work or inferred fallback from an explicit missing generation.
 */
export const planBuildRecovery = async ({ root, userConfig, indexRoot, operation = 'validate', modes = null, resumeTarget = 'full', signal = null }) => {
  throwIfAborted(signal);
  if (!['validate', 'publish', 'graph', 'resume', 'refresh', 'clean'].includes(operation)) throw fail('ERR_RECOVERY_OPERATION', 'Supported recovery operations are validate, publish, graph, resume, refresh and clean.');
  if (!['full', 'stage2'].includes(resumeTarget)) throw fail('ERR_RECOVERY_OPERATION', 'Resume target must be full or stage2.');
  const buildRoot = validRoot(root, indexRoot, userConfig);
  const { value: state, hash: stateHash } = await readBuildMetadata(buildRoot, path.join(buildRoot, 'build_state.json'), 8 * 1024 * 1024);
  if (state?.artifactSurfaceVersion !== ARTIFACT_SURFACE_VERSION || state.schemaVersion !== 1
    || typeof state.buildId !== 'string' || !state.buildId
    || !samePath(state.buildRoot || '.', buildRoot) || !samePath(state.repoRoot || '.', root)) {
    throw fail('ERR_RECOVERY_GENERATION', 'Retained build metadata belongs to another repository or format.');
  }
  const requestedModes = modes || (operation === 'graph' ? ['code'] : state.modes);
  const selectedModes = Array.isArray(requestedModes) ? [...requestedModes] : requestedModes;
  if (!Array.isArray(selectedModes) || !selectedModes.length || selectedModes.length > 4
    || selectedModes.some(mode => !MODES.has(mode)) || new Set(selectedModes).size !== selectedModes.length) {
    throw fail('ERR_RECOVERY_MODES', 'Recovery requires explicit supported modes present in retained metadata.');
  }
  if (selectedModes.some(mode => !state.modes?.includes(mode))) throw fail('ERR_RECOVERY_MODES', 'Requested mode is absent from the selected generation.');
  if (operation === 'graph' && (selectedModes.length !== 1 || selectedModes[0] !== 'code')) throw fail('ERR_RECOVERY_MODES', 'Graph capability validation requires exactly the retained code mode.');
  const evidence = [];
  for (const mode of selectedModes) {
    throwIfAborted(signal);
    const retainedCompletion = state.completedStages?.[mode] || null;
    try {
      const { value: publication, hash: publicationHash } = await readBuildMetadata(buildRoot, resolveArtifactPublicationPath(buildRoot, mode));
      const completion = await readCompletedStage({ buildRoot, mode, state, signal });
      evidence.push({ mode, status: completion ? 'sealed-unverified' : 'unverified', publicationHash,
        completion: completion || null, graphCapability: completion?.snapshot?.graphCapability || state.graphCapabilities?.[mode]?.graphCapability || null,
        reason: completion ? 'exact-bytes-revalidation-required' : 'completion-receipt-missing' });
    } catch (error) {
      if (!['ENOENT', 'ERR_FILE_TOO_LARGE'].includes(error.code) && !(error instanceof SyntaxError)) throw error;
      evidence.push({ mode, status: retainedCompletion ? 'sealed-unverified' : 'missing', publicationHash: null, completion: retainedCompletion,
        reason: error.code === 'ENOENT' ? 'publication-record-missing' : 'publication-record-invalid' });
    }
  }
  const lock = await readIndexLockInfo(getRepoCacheRoot(root, userConfig));
  const resume = operation === 'resume';
  const fresh = operation === 'refresh' || operation === 'clean';
  const executeBuild = resume || fresh;
  const currentGeneration = resume && await isCurrentGeneration(root, userConfig, buildRoot);
  const source = evidence.map(row => row.completion?.sourceSnapshot).find(value => value?.identity);
  const reusableModes = evidence.filter(row => row.completion?.schemaVersion === 2 && row.completion?.sourceValidation?.status === 'verified' && row.completion?.reusePolicy
    && row.completion?.producer?.identity && row.completion?.sourceSnapshot?.identity).map(row => row.mode);
  const missingModes = fresh ? selectedModes : selectedModes.filter(mode => !evidence.find(row => row.mode === mode)?.completion);
  const invalidModes = selectedModes.filter(mode => !reusableModes.includes(mode) && !missingModes.includes(mode));
  const plan = { schemaVersion: 1, operation, repoRoot: toRealPathSync(root), buildRoot, buildId: state.buildId,
    modes: selectedModes, stateHash, configIdentity: hash(userConfig), currentPointerIdentity: await pointerIdentity(root, userConfig),
    sourceScope: fresh ? 'current-working-tree-refresh' : 'retained-historical-snapshot', sourceFreshness: 'not-checked-against-working-tree',
    ...(executeBuild ? { resumeTarget, sourceVerification: 'fresh-canonical-preprocessing-required-before-any-restore',
      destination: fresh ? { kind: 'new-generation', buildRoot: null, reason: 'existing-runtime-allocates-generation-at-execution' }
        : { kind: 'same-generation', buildRoot },
      reusedModes: fresh ? [] : reusableModes, rebuiltModes: missingModes, invalidModes: fresh ? [] : invalidModes,
      backends: { embeddings: resumeTarget === 'full' ? 'effective-existing-build-policy' : 'not-requested',
        sqlite: resumeTarget === 'full' && userConfig.sqlite?.use !== false },
      originalPhases: Object.fromEntries(Object.entries(state.phases || {}).slice(-16).map(([phase, value]) => [phase,
        { status: value.status || null, updatedAt: value.updatedAt || null, finishedAt: value.finishedAt || null }])) } : {}),
    modeEvidence: evidence, originalStage: state.stage || null, originalFailurePreserved: true,
    sourceConfigHash: state.configHash || null, repoProvenance: state.repo || null,
    work: { parseFiles: executeBuild && missingModes.length ? null : 0,
      generateEmbeddings: executeBuild && resumeTarget === 'full' ? 'effective-existing-build-policy' : false,
      rebuildArtifacts: executeBuild && missingModes.length > 0,
      validateExistingBytes: true, publishCurrentPointer: operation === 'publish' || executeBuild },
    requiredDownloads: executeBuild && resumeTarget === 'full' ? [{ status: 'unknown', reason: 'existing-backend-owner-resolves-required-assets-at-execution' }] : [],
    additionalArtifactBytes: executeBuild || operation === 'graph' ? null : 0,
    blocked: lock ? 'repository-writer-lease-present' : currentGeneration ? 'selected-generation-is-current-and-cannot-be-mutated'
      : resume && (!source || invalidModes.length) ? 'compatible-immutable-source-checkpoint-missing' : null,
    limitations: ['Historical resume rejects changed inputs; refresh requires a new ordinary build.',
      'Graph capability is independent of vector/SQLite readiness and normal current selection.',
      'Publication requires every selected mode seal and normal validation under current validation policy.'] };
  return { ...plan, planId: hash(plan) };
};

/** Execute the reviewed transaction under the normal writer owner. Validation
 * never constructs a build runtime, so it cannot parse or initialize embeddings.
 */
export const executeBuildRecovery = async ({ root, userConfig, plan, signal = null, log = () => {}, resumeBuild = null }) => {
  const encodedPlan = JSON.stringify(plan);
  if (typeof encodedPlan !== 'string' || Buffer.byteLength(encodedPlan) > 512 * 1024) throw fail('ERR_RECOVERY_PLAN', 'Reviewed plan exceeds its metadata allowance.');
  plan = JSON.parse(encodedPlan);
  if (!plan?.planId) throw fail('ERR_RECOVERY_PLAN', 'A reviewed recovery plan is required.');
  if (hash(Object.fromEntries(Object.entries(plan).filter(([key]) => key !== 'planId'))) !== plan.planId
    || !samePath(plan.repoRoot || '.', root) || plan.configIdentity !== hash(userConfig)) {
    throw fail('ERR_RECOVERY_PLAN_STALE', 'Recovery request differs from the reviewed plan or current configuration.');
  }
  const selectedRoot = validRoot(root, plan.buildRoot, userConfig);
  const { value: prior } = await readBuildMetadata(selectedRoot, path.join(selectedRoot, 'build_state.json'), 8 * 1024 * 1024, signal);
  const completed = prior.recoveryTransactions?.[plan.planId];
  if (completed?.status === 'completed') {
    if (completed.operation !== plan.operation || completed.buildId !== plan.buildId || prior.buildId !== plan.buildId) throw fail('ERR_RECOVERY_PLAN_STALE', 'Completed recovery belongs to another generation.');
    // Completion is historical authority, never a new mutation or current-pointer claim.
    if (plan.operation === 'graph') return withRetainedGraph({ root, userConfig, buildRoot: selectedRoot, buildId: plan.buildId, signal },
      graph => ({ ...completed.result, graph, alreadyComplete: true }));
    const repoCacheRoot = getRepoCacheRoot(root, userConfig);
    const lock = await acquireIndexLock({ repoCacheRoot, signal, requireSettlement: true,
      storageContext: { repoRoot: root, userConfig }, metadata: { owner: 'build-recovery-confirmation' }, log });
    if (!lock) throw fail('ERR_RECOVERY_BUSY', 'Repository writer lease is unavailable for completion confirmation.');
    const lease = createIndexCacheLease(lock, repoCacheRoot);
    let operationError = null;
    try {
      const completedPlan = { ...plan, buildRoot: validRoot(root, completed.result.buildRoot, userConfig), buildId: completed.result.buildId };
      const validation = await validateIndexArtifacts({ root, indexRoot: completedPlan.buildRoot, userConfig, modes: plan.modes,
        sqliteEnabled: userConfig.sqlite?.use !== false && !(['resume', 'refresh', 'clean'].includes(plan.operation) && plan.resumeTarget === 'stage2'),
        strict: true, abortSignal: signal });
      if (!validation.ok) throw fail('ERR_RECOVERY_PLAN_STALE', 'Previously completed recovery artifacts no longer validate.');
      if (!Array.isArray(completed.outputIdentities) || hash(completed.outputIdentities) !== hash(await outputIdentities(completedPlan, signal))) throw fail('ERR_RECOVERY_PLAN_STALE', 'Completed recovery output identities changed or are unavailable.');
      return { ...completed.result, alreadyComplete: true,
        publication: { ...completed.result.publication, currentPointerUnchangedSinceCompletion:
          completed.currentPointerIdentity === await pointerIdentity(root, userConfig) } };
    } catch (error) { operationError = error; throw error; }
    finally { await settleBuildRecoveryWriter({ lease, lock, operationError }); }
  }
  const currentPlan = await planBuildRecovery({ root, userConfig, indexRoot: plan.buildRoot,
    operation: plan.operation, modes: plan.modes, resumeTarget: plan.resumeTarget, signal });
  if (currentPlan.planId !== plan.planId || hash(Object.fromEntries(Object.entries(plan).filter(([key]) => key !== 'planId'))) !== plan.planId) {
    throw fail('ERR_RECOVERY_PLAN_STALE', 'Recovery plan changed; inspect the exact generation again.');
  }
  if (currentPlan.blocked) throw fail(currentPlan.blocked === 'repository-writer-lease-present' ? 'ERR_RECOVERY_BUSY' : 'ERR_RECOVERY_CHECKPOINT_UNAVAILABLE',
    `Recovery is blocked: ${currentPlan.blocked}.`);
  const repoCacheRoot = getRepoCacheRoot(root, userConfig);
  const lock = await acquireIndexLock({ repoCacheRoot, signal, requireSettlement: true,
    storageContext: { repoRoot: root, userConfig }, metadata: { owner: 'build-recovery', operation: plan.operation }, log });
  if (!lock) throw fail('ERR_RECOVERY_BUSY', 'Repository writer lease is unavailable.');
  let lease = null, operationError = null, attempt = null, published = false, publicationBuildId = plan.buildId;
  let publicationBuildRoot = plan.buildRoot, publicationAttemptId = null;
  const publicationFacts = () => ({ status: 'published', buildId: publicationBuildId, buildRoot: publicationBuildRoot,
    runtimeAttemptId: publicationAttemptId, recoveryPlanId: plan.planId,
    sourceBuildId: plan.buildId, sourceBuildRoot: plan.buildRoot });
  try {
    lease = createIndexCacheLease(lock, repoCacheRoot);
    // Recheck after admission, without treating our own newly acquired lock as a stale plan.
    const admitted = await planBuildRecovery({ root, userConfig, indexRoot: plan.buildRoot, operation: plan.operation,
      modes: plan.modes, resumeTarget: plan.resumeTarget, signal });
    const { blocked: _blocked, planId: _planId, ...admittedContent } = admitted;
    if (hash({ ...admittedContent, blocked: plan.blocked }) !== plan.planId) throw fail('ERR_RECOVERY_PLAN_STALE', 'Recovery evidence changed during writer admission.');
    if (plan.operation === 'publish') for (const mode of plan.modes) {
      const immutable = plan.modeEvidence.find(row => row.mode === mode)?.completion?.schemaVersion === 2;
      await verifyCompletedStage({ buildRoot: plan.buildRoot, buildId: plan.buildId, repoRoot: root, mode, snapshot: immutable, signal });
    }
    attempt = await createRuntimeAttempt({ buildId: plan.buildId, stage: `recovery-${plan.operation}`,
      inputs: { recoveryPlanId: plan.planId, sourceScope: plan.sourceScope, modes: plan.modes,
        originalPhases: plan.originalPhases || null },
      embeddings: { observation: { state: 'not-run', provider: null, dims: null, observedAt: null } } });
    await persistRuntimeAttempt(plan.buildRoot, attempt, { lifecycle: 'running' });
    let resumed = null;
    const executeBuild = ['resume', 'refresh', 'clean'].includes(plan.operation);
    if (executeBuild) {
      if (typeof resumeBuild !== 'function') throw fail('ERR_RECOVERY_EXECUTOR', 'Resume requires the existing core build executor.');
      if (plan.operation === 'resume' && await isCurrentGeneration(root, userConfig, plan.buildRoot)) throw fail('ERR_RECOVERY_PLAN_STALE', 'Generation became current before restore; no mode bytes were changed.');
      const grant = createBuildRecoveryGrant({ root, repoCacheRoot, buildRoot: plan.operation === 'resume' ? plan.buildRoot : null,
        kind: plan.operation === 'resume' ? 'same-generation' : 'new-generation', clean: plan.operation === 'clean', lease, plan });
      resumed = await resumeBuild(grant, { modes: plan.modes, mode: plan.modes.length === 1 ? plan.modes[0] : 'all',
        stage: plan.resumeTarget === 'stage2' ? 'stage2' : undefined, incremental: false });
      const backend = resumed.stage3?.embeddings;
      if (resumed.cancelled || backend?.cancelled) throw fail('ERR_RECOVERY_CANCELLED', 'Resume was cancelled before publication.');
      if (backend?.queued || backend?.mixed || backend?.notAdmitted) throw fail('ERR_RECOVERY_PENDING', 'Resume backend work is incomplete; generation remains retained.');
    }
    const execution = resumed?.stage2 || resumed;
    const executionRoot = validRoot(root, execution?.buildRoot || plan.buildRoot, userConfig), executionId = execution?.buildId || plan.buildId;
    if (plan.operation === 'resume' && (!samePath(executionRoot, plan.buildRoot) || executionId !== plan.buildId)) {
      throw fail('ERR_RECOVERY_AUTHORITY', 'Historical resume executor selected another generation.');
    }
    const graph = plan.operation === 'graph' ? await sealRetainedGraph({ root, userConfig, buildRoot: plan.buildRoot,
      buildId: plan.buildId, repoCacheRoot, lease, signal }) : null;
    const validation = graph ? { ok: true } : await validateIndexArtifacts({ root, indexRoot: executionRoot, userConfig, modes: plan.modes,
      sqliteEnabled: userConfig.sqlite?.use !== false && !(executeBuild && plan.resumeTarget === 'stage2'),
      strict: true, abortSignal: signal });
    if (!validation.ok) throw Object.assign(fail('ERR_RECOVERY_VALIDATION', 'Retained generation failed required validation; pointer preserved.'), { validation });
    throwIfAborted(signal);
    assertIndexCacheLease(lease, repoCacheRoot);
    if (plan.operation === 'publish' || executeBuild) {
      publicationBuildId = executionId;
      publicationBuildRoot = executionRoot;
      publicationAttemptId = execution?.runtimeAttemptId || attempt.attemptId;
      await promoteBuild({ repoRoot: root, userConfig, buildRoot: executionRoot, buildId: executionId,
        stage: executeBuild ? plan.resumeTarget === 'stage2' ? 'stage2' : 'stage4' : plan.originalStage,
        modes: plan.modes, configHash: (resumed?.stage2 || resumed)?.configHash || plan.sourceConfigHash,
        repoProvenance: execution?.repoProvenance || plan.repoProvenance, abortSignal: signal, expectedCurrentPointerHash: plan.currentPointerIdentity });
      published = true;
    }
    const result = { modes: plan.modes, repo: root, stage: `recovery-${plan.operation}`, buildId: executionId,
      buildRoot: executionRoot, runtimeAttemptId: execution?.runtimeAttemptId || attempt.attemptId,
      recoveryAttemptId: attempt.attemptId, recoveryPlanId: plan.planId,
      sourceBuildRoot: plan.buildRoot, sourceBuildId: plan.buildId,
      sourceScope: plan.sourceScope, work: resumed ? {
        modes: summarizeRecoveryModeWork((resumed.stage2 || resumed).completedStageWork),
        reusedModes: plan.reusedModes, rebuiltModes: plan.rebuiltModes,
        parsedFiles: plan.rebuiltModes.length ? null : 0,
        embeddings: summarizeRecoveryBackend(resumed.stage3?.embeddings || { skipped: true }, 'embeddings'),
        sqlite: summarizeRecoveryBackend(resumed.stage4?.sqlite || { skipped: true }, 'sqlite')
      } : { parsedFiles: 0, embeddedFiles: 0, rebuiltArtifacts: 0 },
      validation: { status: 'passed' }, publication: published ? publicationFacts() : { status: 'retained' },
      ...(graph ? { graph } : {}),
      ...(resumed ? { execution: resumed, executionEvidence: { kind: 'runtime-attempt', buildRoot: executionRoot,
        buildId: executionId, attemptId: execution?.runtimeAttemptId || attempt.attemptId } } : {}),
      originalFailurePreserved: true };
    await persistRuntimeAttempt(plan.buildRoot, attempt, { lifecycle: 'succeeded', runtime: { recovery: result.work } });
    await updateBuildState(plan.buildRoot, { recoveryTransactions: { [plan.planId]: { status: 'completed', operation: plan.operation,
      buildId: plan.buildId, completedAt: new Date().toISOString(), currentPointerIdentity: await pointerIdentity(root, userConfig),
      outputIdentities: graph ? null : await outputIdentities({ ...plan, buildRoot: executionRoot, buildId: executionId }, signal),
      result: durableRecoveryResult(result) } } });
    return result;
  } catch (error) {
    // Capture original resource observations before inspecting diagnostics or
    // persisting another receipt. Inspection itself can own independent work.
    operationError = addStorageFailureContext(error, { recoveryPhase: 'execution' }, null, { forceAggregate: true });
    try { if (!published && operationError.publication?.status === 'published') published = true; }
    catch (inspectionError) { operationError = addStorageFailureContext(operationError, {}, inspectionError, { secondaryPresent: true, forceAggregate: true }); }
    if (published) {
      operationError = addStorageFailureContext(operationError, { code: 'ERR_RECOVERY_POST_COMMIT',
        publication: publicationFacts() }, null, { forceAggregate: true });
    } else if (attempt) {
      let code = 'UNKNOWN', aborted = signal?.aborted === true;
      try {
        const actualCode = operationError.code;
        if (typeof actualCode === 'string') code = actualCode;
        const actualName = operationError.name;
        aborted ||= actualName === 'AbortError' || actualCode === 'ABORT_ERR';
      } catch (inspectionError) { operationError = addStorageFailureContext(operationError, {}, inspectionError, { secondaryPresent: true, forceAggregate: true }); }
      try { await persistRuntimeAttempt(plan.buildRoot, attempt, { lifecycle: aborted ? 'aborted' : 'failed',
        error: { code, message: 'Retained recovery did not publish.' } }); }
      catch (recordingError) { operationError = addStorageFailureContext(operationError, {}, recordingError, { secondaryPresent: true, forceAggregate: true }); }
    }
    throw operationError;
  } finally {
    try { await settleBuildRecoveryWriter({ lease, lock, operationError }); }
    catch (error) {
      if (!published) throw error;
      throw addStorageFailureContext(error, { code: 'ERR_RECOVERY_POST_COMMIT',
        publication: publicationFacts() }, null, { forceAggregate: true });
    }
  }
};

export const withBuildGraphCapability = async ({ root, userConfig, indexRoot, capabilityId = null, signal = null }, consume) => {
  const buildRoot = validRoot(root, indexRoot, userConfig);
  const { value: state } = await readBuildMetadata(buildRoot, path.join(buildRoot, 'build_state.json'), 8 * 1024 * 1024, signal);
  if (state.artifactSurfaceVersion !== ARTIFACT_SURFACE_VERSION || !samePath(state.repoRoot || '.', root)
    || !samePath(state.buildRoot || '.', buildRoot) || typeof state.buildId !== 'string') throw fail('ERR_RECOVERY_GENERATION', 'Graph generation identity is invalid.');
  return withRetainedGraph({ root, userConfig, buildRoot, buildId: state.buildId, capabilityId, signal }, consume);
};
