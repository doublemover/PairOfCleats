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

export async function updateBuildState(buildRoot, patch) {
  if (!buildRoot || !patch) return null;
  const events = collectCheckpointEvents(patch.stageCheckpoints);
  return patchQueue.queueStatePatch(buildRoot, patch, events);
}

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

export async function loadOrderingLedger(buildRoot) {
  if (!buildRoot) return null;
  const loaded = await loadBuildState(buildRoot);
  return normalizeOrderingLedger(loaded?.state?.orderingLedger);
}

export function validateOrderingLedger(ledger) {
  return validateOrderingLedgerShape(ledger);
}

export async function exportOrderingLedger(buildRoot, outputPath = null) {
  const ledger = await loadOrderingLedger(buildRoot);
  if (outputPath && ledger) {
    await atomicWriteJson(outputPath, ledger, { spaces: 0 });
  }
  return ledger;
}

export async function flushBuildState(buildRoot) {
  return patchQueue.flushBuildState(buildRoot);
}

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

export function resolveBuildStatePath(buildRoot) {
  return buildRoot ? resolveStatePath(buildRoot) : null;
}
