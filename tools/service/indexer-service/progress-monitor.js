import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { formatDurationMs } from '../../../src/shared/time-format.js';
import { createLifecycleRegistry } from '../../../src/shared/lifecycle/registry.js';
import { getRepoCacheRoot } from '../../shared/dict-utils.js';

const BUILD_STATE_FILE = 'build_state.json';
const BUILD_STATE_POLL_MS = 5000;
const BUILD_STATE_LOOKBACK_MS = 5 * 60 * 1000;

/**
 * Resolve the build artifacts root under one repo cache root.
 *
 * @param {string} repoCacheRoot
 * @returns {string}
 */
const resolveBuildsRoot = (repoCacheRoot) => path.join(repoCacheRoot, 'builds');

/**
 * Read one build-state snapshot from a build root directory.
 *
 * @param {string|null} buildRoot
 * @returns {Promise<{state:object,path:string}|null>}
 */
const readBuildState = async (buildRoot) => {
  if (!buildRoot) return null;
  const statePath = path.join(buildRoot, BUILD_STATE_FILE);
  try {
    const raw = await fsPromises.readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? { state: parsed, path: statePath } : null;
  } catch {
    return null;
  }
};

/**
 * Enumerate build directories that currently expose `build_state.json`.
 *
 * Returned list is sorted newest-first by state file mtime so callers can
 * prefer active/latest builds without scanning timestamps again.
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
    const statePath = path.join(buildRoot, BUILD_STATE_FILE);
    try {
      const stat = await fsPromises.stat(statePath);
      candidates.push({ buildRoot, statePath, mtimeMs: stat.mtimeMs });
    } catch {}
  }
  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
};

/**
 * Pick the newest viable build-state snapshot for stage progress reporting.
 *
 * @param {string} repoCacheRoot
 * @param {string|null} stage
 * @param {number} sinceMs
 * @returns {Promise<{buildRoot:string,state:object,path:string}|null>}
 */
const pickBuildState = async (repoCacheRoot, stage, sinceMs) => {
  const candidates = await listBuildStateCandidates(repoCacheRoot);
  for (const candidate of candidates) {
    if (Number.isFinite(sinceMs) && candidate.mtimeMs < sinceMs) continue;
    const loaded = await readBuildState(candidate.buildRoot);
    if (!loaded) continue;
    const state = loaded.state;
    if (stage && state?.stage && state.stage !== stage) continue;
    if (stage && state?.phases?.[stage]?.status === 'failed') continue;
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
export const startBuildProgressMonitor = ({ job, repoPath, stage }) => {
  if (!job || !repoPath) return async () => {};
  const repoCacheRoot = getRepoCacheRoot(repoPath);
  const startedAt = Date.now();
  let active = null;
  let waitingLogged = false;
  let lastLine = '';
  const lifecycle = createLifecycleRegistry({
    name: `indexer-service-progress:${job.id}`
  });
  const poll = async () => {
    if (!active) {
      active = await pickBuildState(repoCacheRoot, stage, startedAt - BUILD_STATE_LOOKBACK_MS);
    }
    if (!active) {
      if (!waitingLogged) {
        console.error(`[indexer] job ${job.id} ${stage || 'stage'} running; waiting for build state...`);
        waitingLogged = true;
      }
      return;
    }
    const loaded = await readBuildState(active.buildRoot);
    if (loaded?.state) active.state = loaded.state;
    const line = formatProgressLine({ jobId: job.id, stage, state: active.state });
    if (line && line !== lastLine) {
      console.error(line);
      lastLine = line;
    }
  };
  const runPoll = () => {
    if (lifecycle.isClosed()) return;
    lifecycle.registerPromise(poll(), { label: 'indexer-service-progress-poll' });
  };
  const timer = setInterval(() => {
    runPoll();
  }, BUILD_STATE_POLL_MS);
  lifecycle.registerTimer(timer, { label: 'indexer-service-progress-interval' });
  runPoll();
  return async () => {
    await lifecycle.close().catch(() => {});
  };
};
