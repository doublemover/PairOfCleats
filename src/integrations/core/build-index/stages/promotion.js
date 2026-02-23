import { promoteBuild } from '../../../../index/build/promotion.js';
import { throwIfAborted } from '../../../../shared/abort.js';
import { acquireBuildIndexLock } from './lock.js';

/**
 * Execute the `promote` phase with lock protection and explicit phase updates.
 *
 * Failure handling contract:
 * 1. `phaseState.running` flips to `true` only after the phase is marked running.
 * 2. `phaseState.done` flips to `true` only after promote is fully committed.
 * 3. Any thrown error preserves this state so callers can mark failed phases.
 * 4. Lock release is guaranteed via `finally`, even when promotion fails.
 *
 * @param {object} input
 * @param {boolean} [input.shouldPromote]
 * @param {object} input.runtime
 * @param {'stage1'|'stage2'|'stage3'|'stage4'} input.stage
 * @param {string[]} input.modes
 * @param {(line:string)=>void} input.log
 * @param {(buildRoot:string,phase:string,status:string,detail?:string)=>Promise<void>} input.markPhase
 * @param {{running:boolean,done:boolean}} input.phaseState
 * @param {string|null} [input.compatibilityKey]
 * @param {string} [input.skipDetail]
 * @param {()=>void|Promise<void>} [input.onSkipped]
 * @param {AbortSignal|null} [input.abortSignal]
 * @returns {Promise<{skipped:boolean}>}
 */
export const runPromotionPhase = async ({
  shouldPromote = true,
  runtime,
  stage,
  modes,
  log,
  markPhase,
  phaseState,
  compatibilityKey = null,
  skipDetail = 'skipped',
  onSkipped = null,
  abortSignal = null
}) => {
  if (!shouldPromote) {
    await markPhase(runtime.buildRoot, 'promote', 'done', skipDetail);
    phaseState.done = true;
    if (typeof onSkipped === 'function') {
      await onSkipped();
    }
    return { skipped: true };
  }

  let lock = null;
  try {
    lock = await acquireBuildIndexLock({ repoCacheRoot: runtime.repoCacheRoot, log });
    await markPhase(runtime.buildRoot, 'promote', 'running');
    phaseState.running = true;
    if (abortSignal) {
      throwIfAborted(abortSignal);
    }
    await promoteBuild({
      repoRoot: runtime.root,
      userConfig: runtime.userConfig,
      buildId: runtime.buildId,
      buildRoot: runtime.buildRoot,
      stage,
      modes,
      configHash: runtime.configHash,
      repoProvenance: runtime.repoProvenance,
      compatibilityKey
    });
    await markPhase(runtime.buildRoot, 'promote', 'done');
    phaseState.done = true;
    return { skipped: false };
  } finally {
    if (lock?.release) {
      await lock.release();
    }
  }
};
