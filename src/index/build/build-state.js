import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteJson } from '../../shared/io/atomic-write.js';
import {
  INDEX_PROFILE_DEFAULT,
  INDEX_PROFILE_SCHEMA_VERSION,
  normalizeIndexProfileId
} from '../../contracts/index-profile.js';
import { collectCheckpointEvents } from './build-state/checkpoints.js';
import { startHeartbeat } from './build-state/heartbeat.js';
import { createPatchQueue } from './build-state/patch-queue.js';
import {
  ORDERING_LEDGER_SCHEMA_VERSION,
  normalizeOrderingLedger,
  normalizeSeedInputs,
  resolveStageKey,
  validateOrderingLedgerShape
} from './build-state/order-ledger.js';
import {
  applyStatePatch,
  buildRootExists,
  ensureStateVersions,
  loadBuildState,
  mergeState,
  recordStateError,
  resolveStatePath,
  setActiveStateKeyResolver
} from './build-state/store.js';
import { markBuildPhaseState } from './build-state/phases.js';
import { createBuildCheckpointTracker } from './build-state/progress.js';

const patchQueue = createPatchQueue({
  mergeState,
  applyStatePatch,
  recordStateError
});
setActiveStateKeyResolver(patchQueue.isActiveStateKey);

export { ORDERING_LEDGER_SCHEMA_VERSION };

/**
 * Initialize build-state metadata file for a build root.
 *
 * @param {object} input
 * @returns {Promise<string|null>}
 */
export async function initBuildState({
  buildRoot,
  buildId,
  repoRoot,
  modes,
  stage,
  configHash,
  toolVersion,
  repoProvenance,
  signatureVersion,
  profile = null
}) {
  if (!buildRoot) return null;
  const statePath = resolveStatePath(buildRoot);
  const now = new Date().toISOString();
  const payload = {
    schemaVersion: 1,
    buildId,
    buildRoot: path.resolve(buildRoot),
    repoRoot: repoRoot ? path.resolve(repoRoot) : null,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    finishedAt: null,
    stage: stage || null,
    modes: Array.isArray(modes) ? modes : null,
    currentPhase: null,
    tool: {
      version: toolVersion || null,
      node: process.version
    },
    signatureVersion: signatureVersion ?? null,
    configHash: configHash || null,
    profile: {
      id: normalizeIndexProfileId(profile?.id, INDEX_PROFILE_DEFAULT),
      schemaVersion: Number.isFinite(Number(profile?.schemaVersion))
        ? Math.max(1, Math.floor(Number(profile.schemaVersion)))
        : INDEX_PROFILE_SCHEMA_VERSION
    },
    repo: repoProvenance || null,
    phases: {},
    progress: {}
  };
  await fs.mkdir(buildRoot, { recursive: true });
  await atomicWriteJson(statePath, payload, { spaces: 0 });
  return statePath;
}

/**
 * Queue a state patch and emit derived checkpoint events.
 *
 * @param {string} buildRoot
 * @param {object} patch
 * @returns {Promise<object|null>}
 */
export async function updateBuildState(buildRoot, patch) {
  if (!buildRoot || !patch) return null;
  const events = collectCheckpointEvents(patch.stageCheckpoints);
  return patchQueue.queueStatePatch(buildRoot, patch, events);
}

/**
 * Record deterministic ordering-seed inputs for overall or stage-scoped ledger state.
 *
 * @param {string} buildRoot
 * @param {object} [inputs]
 * @param {{stage?:string|null,mode?:string|null}} [options]
 * @returns {Promise<object|null>}
 */
export async function recordOrderingSeedInputs(buildRoot, inputs = {}, { stage = null, mode = null } = {}) {
  if (!buildRoot) return null;
  const seeds = normalizeSeedInputs({ ...inputs, mode });
  const stageKey = resolveStageKey(stage, mode);
  const patch = {
    orderingLedger: {
      schemaVersion: ORDERING_LEDGER_SCHEMA_VERSION,
      seeds,
      ...(stageKey ? { stages: { [stageKey]: { seeds } } } : {})
    }
  };
  return updateBuildState(buildRoot, patch);
}

/**
 * Record a stage artifact ordering hash if it changed.
 * No-op when the current ledger entry already matches.
 *
 * @param {string} buildRoot
 * @param {object} [input]
 * @returns {Promise<object|null>}
 */
export async function recordOrderingHash(buildRoot, {
  stage,
  mode = null,
  artifact,
  hash,
  rule = null,
  count = null
} = {}) {
  if (!buildRoot || !stage || !artifact || !hash) return null;
  const stageKey = resolveStageKey(stage, mode);
  if (!stageKey) return null;
  const loaded = await loadBuildState(buildRoot);
  const currentLedger = normalizeOrderingLedger(loaded?.state?.orderingLedger);
  const currentEntry = currentLedger?.stages?.[stageKey]?.artifacts?.[artifact];
  const entry = {
    hash,
    rule,
    count: Number.isFinite(count) ? count : null,
    mode
  };
  if (currentEntry
    && currentEntry.hash === entry.hash
    && currentEntry.rule === entry.rule
    && currentEntry.count === entry.count
    && currentEntry.mode === entry.mode) {
    return currentLedger;
  }
  const patch = {
    orderingLedger: {
      schemaVersion: ORDERING_LEDGER_SCHEMA_VERSION,
      stages: {
        [stageKey]: {
          artifacts: {
            [artifact]: entry
          }
        }
      }
    }
  };
  return updateBuildState(buildRoot, patch);
}

/**
 * Load and normalize persisted ordering ledger state.
 *
 * @param {string} buildRoot
 * @returns {Promise<object|null>}
 */
export async function loadOrderingLedger(buildRoot) {
  if (!buildRoot) return null;
  const loaded = await loadBuildState(buildRoot);
  return normalizeOrderingLedger(loaded?.state?.orderingLedger);
}

/**
 * Validate ordering ledger structural contract.
 *
 * @param {object} ledger
 * @returns {object}
 */
export function validateOrderingLedger(ledger) {
  return validateOrderingLedgerShape(ledger);
}

/**
 * Export normalized ordering ledger to optional path.
 *
 * @param {string} buildRoot
 * @param {string|null} [outputPath]
 * @returns {Promise<object|null>}
 */
export async function exportOrderingLedger(buildRoot, outputPath = null) {
  const ledger = await loadOrderingLedger(buildRoot);
  if (outputPath && ledger) {
    await atomicWriteJson(outputPath, ledger, { spaces: 0 });
  }
  return ledger;
}

/**
 * Flush queued build-state patches for a build root.
 *
 * @param {string} buildRoot
 * @returns {Promise<object|null>}
 */
export async function flushBuildState(buildRoot) {
  return patchQueue.flushBuildState(buildRoot);
}

/**
 * Persist a lifecycle transition for a named build phase.
 *
 * @param {string} buildRoot
 * @param {string} phase
 * @param {string} status
 * @param {object|null} [detail]
 * @returns {Promise<object|null>}
 */
export async function markBuildPhase(buildRoot, phase, status, detail = null) {
  return markBuildPhaseState({
    buildRoot,
    phase,
    status,
    detail,
    buildRootExists,
    loadBuildState,
    ensureStateVersions,
    queueStatePatch: patchQueue.queueStatePatch
  });
}

/**
 * Start periodic heartbeat patching for a build stage.
 *
 * @param {string} buildRoot
 * @param {string} stage
 * @param {number} [intervalMs]
 * @returns {{stop:()=>Promise<void>,flush:()=>Promise<void>}|null}
 */
export function startBuildHeartbeat(buildRoot, stage, intervalMs = 30000) {
  return startHeartbeat({
    buildRoot,
    stage,
    intervalMs,
    updateBuildState,
    flushBuildState,
    buildRootExists
  });
}

/**
 * Create per-mode checkpoint writer for processed-file progress.
 *
 * @param {object} input
 * @returns {{tick:()=>void,finish:()=>void}}
 */
export function createBuildCheckpoint({
  buildRoot,
  mode,
  totalFiles,
  batchSize = 1000,
  intervalMs = 120000
}) {
  return createBuildCheckpointTracker({
    buildRoot,
    mode,
    totalFiles,
    batchSize,
    intervalMs,
    updateBuildState
  });
}

/**
 * Resolve build-state file path for a build root.
 *
 * @param {string} buildRoot
 * @returns {string|null}
 */
export function resolveBuildStatePath(buildRoot) {
  return buildRoot ? resolveStatePath(buildRoot) : null;
}
