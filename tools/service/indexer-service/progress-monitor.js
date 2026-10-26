import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { formatDurationMs } from '../../../src/shared/time-format.js';
import { createLifecycleRegistry } from '../../../src/shared/lifecycle/registry.js';
import { getRepoCacheRoot } from '../../shared/dict-utils.js';
import {
  readServiceBuildStateSnapshot,
  resolveServiceBuildStatePath,
  observeServiceBuildStateSnapshot
} from './build-state-observation.js';

const BUILD_STATE_POLL_MS = 5000;

/**
 * Resolve the build artifacts root under one repo cache root.
 *
 * @param {string} repoCacheRoot
 * @returns {string}
 */
const resolveBuildsRoot = (repoCacheRoot) => path.join(repoCacheRoot, 'builds');

/**
 * Enumerate build directories that currently expose `build_state.json`.
 *
 * Mtime orders discovery only. A candidate still needs the current execution's
 * exact persisted runtime identity before any progress can be displayed.
 *
 * @param {string} repoCacheRoot
 * @returns {Promise<Array<{buildRoot:string,statePath:string,mtimeMs:number}>>}
 */
const listBuildStateCandidates = async (repoCacheRoot) => {
  const buildsRoot = resolveBuildsRoot(repoCacheRoot);
  let entries;
  try {
    entries = await fsPromises.readdir(buildsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const buildRoot = path.join(buildsRoot, entry.name);
    const statePath = resolveServiceBuildStatePath(buildRoot);
    try {
      const stat = await fsPromises.stat(statePath);
      candidates.push({ buildRoot, statePath, mtimeMs: stat.mtimeMs });
    } catch {}
  }
  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
};

/**
 * Correlation comes from the executing claim, never timestamps or a previous
 * completed build. Only the latest runtime attempt may own aggregate progress.
 */
export const ownsBuildProgress = ({ job, stage, state, buildRoot, repoPath }) => {
  const correlationId = job?.observability?.correlation?.correlationId;
  if (typeof correlationId !== 'string' || !correlationId) return false;
  const latestId = state?.runtime?.latestAttemptId;
  if (typeof latestId !== 'string' || !latestId || typeof state.buildId !== 'string' || !state.buildId) return false;
  const attempt = Array.isArray(state?.runtime?.attempts)
    ? state.runtime.attempts.find(row => row?.attemptId === latestId) : null;
  if (!attempt || attempt.correlationId !== correlationId || attempt.buildId !== state.buildId) return false;
  if (job.buildId && state.buildId !== job.buildId) return false;
  if (stage && attempt.stage !== stage) return false;
  if (typeof state.buildRoot !== 'string' || path.relative(buildRoot, state.buildRoot) !== '') return false;
  if (repoPath && (typeof state.repoRoot !== 'string' || path.relative(repoPath, state.repoRoot) !== '')) return false;
  return true;
};

export const pickOwnedBuildState = async ({ job, stage, repoPath, candidates,
  readSnapshot = readServiceBuildStateSnapshot }) => {
  for (const candidate of candidates) {
    const loaded = await readSnapshot(candidate.buildRoot);
    if (!loaded) continue;
    const state = loaded.state;
    if (!ownsBuildProgress({ job, stage, state, buildRoot: candidate.buildRoot, repoPath })) continue;
    return { buildRoot: candidate.buildRoot, state: loaded.state, path: loaded.path };
  }
  return null;
};

const formatDuration = (ms) => formatDurationMs(ms);

/**
 * Format one progress line from build_state snapshot telemetry.
 *
 * @param {{jobId:string,stage:string|null,state:object}} input
 * @returns {string|null}
 */
const formatProgressLine = ({ jobId, stage, state }) => {
  if (!state) return null;
  const phases = state?.phases || {};
  const phase = stage ? phases?.[stage] : null;
  const phaseOrder = ['discovery', 'preprocessing', stage, 'validation', 'promote'].filter(Boolean);
  const activePhase = phaseOrder.find((name) => phases?.[name]?.status === 'running');
  const startedAtRaw = phase?.startedAt || state?.createdAt || null;
  const startedAt = startedAtRaw ? Date.parse(startedAtRaw) : null;
  const now = Date.now();
  const elapsedMs = Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : null;
  const progress = state?.progress || {};
  let processedTotal = 0;
  let totalFiles = 0;
  const modeParts = [];
  for (const [mode, data] of Object.entries(progress)) {
    const processed = Number(data?.processedFiles);
    const total = Number(data?.totalFiles);
    if (!Number.isFinite(processed) || !Number.isFinite(total) || total <= 0) continue;
    processedTotal += processed;
    totalFiles += total;
    modeParts.push(`${mode} ${processed}/${total}`);
  }
  const etaMs = (elapsedMs && processedTotal > 0 && totalFiles > processedTotal)
    ? ((totalFiles - processedTotal) / (processedTotal / (elapsedMs / 1000))) * 1000
    : null;
  const elapsedText = elapsedMs !== null ? formatDuration(elapsedMs) : 'n/a';
  const etaText = Number.isFinite(etaMs) ? formatDuration(etaMs) : 'n/a';
  const status = phase?.status || state?.stage || 'running';
  const progressText = modeParts.length
    ? modeParts.join(' | ')
    : 'progress pending';
  const phaseNote = activePhase && activePhase !== stage ? ` | phase ${activePhase} running` : '';
  return `[indexer] job ${jobId} ${stage || state?.stage || 'stage'} ${status} | ${progressText}${phaseNote} | elapsed ${elapsedText} | eta ${etaText}`;
};

/**
 * Poll build-state artifacts for the active job so long-running work emits
 * periodic progress updates in service worker logs.
 *
 * Returns an async cleanup callback that stops timers and closes tracked
 * lifecycle resources.
 *
 * @param {{job:{id:string},repoPath:string,stage?:string|null}} input
 * @returns {() => Promise<void>}
 */
export const startBuildProgressMonitor = ({ job, repoPath, stage, repoCacheRoot: selectedCacheRoot = null,
  log = (line) => console.error(line) }) => {
  if (!job || !repoPath) return async () => {};
  const repoCacheRoot = selectedCacheRoot || getRepoCacheRoot(repoPath);
  let binding = null;
  let waitingLogged = false;
  let lastLine = '';
  let inFlight = null;
  const work = { polls: 0, discoveries: 0, boundReads: 0, candidateReads: 0,
    bindingInvalidations: 0, knownReadBytes: 0, jsonDecodes: 0, unknownReadAttempts: 0 };
  const statuses = { ok: 0, missing: 0, oversized: 0, corrupt: 0, unsafe: 0, transient: 0 };
  const lifecycle = createLifecycleRegistry({
    name: `indexer-service-progress:${job.id}`
  });
  const readSnapshot = async buildRoot => {
    let observation;
    try { observation = await observeServiceBuildStateSnapshot(buildRoot); }
    catch (error) { work.unknownReadAttempts++; throw error; }
    statuses[observation.status]++;
    work.jsonDecodes += observation.jsonDecodes;
    if (observation.bytes === null) work.unknownReadAttempts++;
    else work.knownReadBytes += observation.bytes;
    return observation.status === 'ok' ? { state: observation.state, path: observation.path } : null;
  };
  const poll = async () => {
    work.polls++;
    let active = null;
    if (binding) {
      work.boundReads++;
      const loaded = await readSnapshot(binding.buildRoot);
      if (loaded && loaded.state.buildId === binding.buildId
        && loaded.state.runtime?.latestAttemptId === binding.attemptId
        && ownsBuildProgress({ job, stage, state: loaded.state, buildRoot: binding.buildRoot, repoPath })) {
        active = { buildRoot: binding.buildRoot, ...loaded };
      } else { binding = null; work.bindingInvalidations++; }
    }
    if (!active) {
      work.discoveries++;
      const candidates = await listBuildStateCandidates(repoCacheRoot);
      active = await pickOwnedBuildState({ job, stage, repoPath, candidates,
        readSnapshot: buildRoot => { work.candidateReads++; return readSnapshot(buildRoot); } });
    }
    if (lifecycle.isClosed()) return;
    if (!active) {
      if (!waitingLogged) {
        log(`[indexer] job ${job.id} ${stage || 'stage'} running; waiting for owned build state...`);
        waitingLogged = true;
      }
      lastLine = '';
      return;
    }
    // Retain only exact binding identity between polls, not the parsed state.
    binding = { buildRoot: active.buildRoot, buildId: active.state.buildId, attemptId: active.state.runtime.latestAttemptId };
    waitingLogged = false;
    const line = formatProgressLine({ jobId: job.id, stage, state: active.state });
    if (line && line !== lastLine) {
      log(line);
      lastLine = line;
    }
  };
  const runPoll = () => {
    if (lifecycle.isClosed()) return Promise.resolve();
    if (inFlight) return inFlight;
    inFlight = lifecycle.registerPromise(poll(), { label: 'indexer-service-progress-poll' })
      .finally(() => { inFlight = null; });
    return inFlight;
  };
  const timer = setInterval(() => {
    void runPoll().catch(error => log(`[indexer] progress monitor failed: ${error?.message || error}`));
  }, BUILD_STATE_POLL_MS);
  lifecycle.registerTimer(timer, { label: 'indexer-service-progress-interval' });
  void runPoll().catch(error => log(`[indexer] progress monitor failed: ${error?.message || error}`));
  const stop = async () => {
    await lifecycle.close();
    binding = null;
  };
  // Internal diagnostic hook also lets bounded fixtures advance the actual poll
  // without changing the production interval or introducing public controls.
  stop.poll = runPoll;
  stop.getDiagnostics = () => Object.freeze({ ...work, statuses: Object.freeze({ ...statuses }),
    binding: binding ? Object.freeze({ ...binding }) : null });
  return stop;
};
