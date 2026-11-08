import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { getBuildsRoot, getRepoCacheRoot } from '../../../shared/dict-utils.js';
import { assertNoSymlinkPath } from '../../../shared/contained-file.js';
import { withStorageDirectory } from '../../../shared/storage/directory.js';
import { acquireRepoCacheAccessLease } from '../../../shared/cache/repo-access.js';
import { observeStorageResource } from '../../../shared/storage/failure-observation.js';
import { addStorageFailureContext, readStorageFailureContext } from '../../../shared/storage/operation-error.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../contracts/versioning.js';
import { readBuildMetadata, sameStagePath } from '../../../index/build/stage-output.js';
import { combineCacheWriterErrors } from '../../../index/build/cache-writer-drain.js';
import { throwIfAborted } from '../../../shared/abort.js';

/** Bounded owned metadata enumeration only. A candidate is an offer; source,
 * output, producer and dependency authority are checked by the normal executor.
 */
export const listBuildRecoveryCandidates = async ({ root, userConfig, modes, signal }) => {
  if (!Array.isArray(modes) || !modes.length || modes.length > 4 || new Set(modes).size !== modes.length
    || modes.some(mode => !['code', 'prose', 'extracted-prose', 'records'].includes(mode))) throw Object.assign(
    new Error('Recovery candidate inventory requires supported explicit modes.'), { code: 'ERR_RECOVERY_MODES' });
  modes = [...modes];
  const repoCacheRoot = getRepoCacheRoot(root, userConfig), buildsRoot = getBuildsRoot(root, userConfig);
  const lease = acquireRepoCacheAccessLease(repoCacheRoot, { scope: 'build-recovery-candidates', resourceId: randomUUID(), requireSettlement: true });
  let primary = null, primaryObservation = null, released = false;
  const release = () => {
    if (primaryObservation && (!primaryObservation.call(primary) || !readStorageFailureContext(primary)?.complete)) throw primary;
    if (!released) released = lease.release() === true;
    if (!released) throw Object.assign(new Error('Candidate metadata reader lease remains unconfirmed.'),
      { code: 'ERR_RECOVERY_READER_RELEASE', cacheOwnershipPending: true, cacheOwnershipReleased: () => released });
    return true;
  };
  try {
    assertNoSymlinkPath(repoCacheRoot, buildsRoot, { allowMissing: true });
    return await withStorageDirectory(buildsRoot, async reader => {
      const candidates = [], rejected = {};
      let examined = 0;
      for (;;) {
        throwIfAborted(signal);
        const entry = await reader.read();
        if (!entry) break;
        if (++examined > 512) return { candidates: [], examined: 512, truncated: true, reason: 'owned-build-metadata-inventory-limit', rejected };
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        const buildRoot = path.join(buildsRoot, entry.name);
        let state;
        try {
          assertNoSymlinkPath(buildsRoot, buildRoot);
          state = (await readBuildMetadata(buildRoot, path.join(buildRoot, 'build_state.json'), 8 * 1024 * 1024, signal)).value;
        } catch (error) {
          observeStorageResource(error, { phase: 'build-recovery-candidate-metadata' }).requireSettled();
          if (!['ENOENT', 'ERR_FILE_TOO_LARGE', 'ERR_UNSAFE_FILE_PATH'].includes(error.code) && !(error instanceof SyntaxError)) throw error;
          rejected['missing-or-invalid-build-metadata'] = (rejected['missing-or-invalid-build-metadata'] || 0) + 1;
          continue;
        }
        if (state.schemaVersion !== 1 || state.artifactSurfaceVersion !== ARTIFACT_SURFACE_VERSION || !sameStagePath(state.repoRoot || '.', root)
          || !sameStagePath(state.buildRoot || '.', buildRoot) || typeof state.buildId !== 'string'
          || !modes.every(mode => state.modes?.includes(mode))) continue;
        const attempts = state.runtime?.attempts || [];
        const latest = attempts.find(attempt => attempt.attemptId === state.runtime.latestAttemptId) || attempts.at(-1);
        if (!latest || !['failed', 'aborted'].includes(latest.lifecycle)) continue;
        const seals = modes.map(mode => state.completedStages?.[mode]).filter(Boolean);
        if (!seals.length || seals.some(receipt => receipt.schemaVersion !== 2 || receipt.sourceValidation?.status !== 'verified' || !receipt.producer?.identity
          || !receipt.reusePolicy || !receipt.sourceSnapshot?.identity || !receipt.snapshot)) continue;
        candidates.push({ buildRoot, buildId: state.buildId, attemptId: latest.attemptId,
          modes, sealedModes: seals.map(receipt => receipt.mode), sourceIdentity: seals[0].sourceSnapshot.identity,
          status: 'candidate-unverified', reason: 'failed-generation-with-immutable-stage-checkpoint' });
      }
      candidates.sort((left, right) => left.buildId < right.buildId ? -1 : left.buildId > right.buildId ? 1 : 0);
      return { candidates, examined, truncated: false, rejected,
        reason: candidates.length === 1 ? 'one-unverified-retained-candidate' : candidates.length ? 'ambiguous-retained-candidates' : 'no-compatible-checkpoint-candidate' };
    });
  } catch (error) {
    primary = addStorageFailureContext(error, { recoveryPhase: 'candidate-enumeration' }, null, { forceAggregate: true });
    primaryObservation = Object.getOwnPropertyDescriptor(primary, 'cacheOwnershipReleased').value;
    observeStorageResource(primary, { phase: 'build-recovery-candidate-directory' }).requireSettled();
    if (error.code === 'ENOENT') return { candidates: [], examined: 0, truncated: false, reason: 'owned-build-directory-absent' };
    throw error;
  } finally {
    try { release(); }
    catch (error) {
      const failure = combineCacheWriterErrors(primary, error);
      Object.defineProperty(failure, 'releaseCandidateReader', { value: release });
      throw failure;
    }
  }
};
