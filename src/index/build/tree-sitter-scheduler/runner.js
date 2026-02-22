import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { throwIfAborted } from '../../../shared/abort.js';
import { runWithConcurrency } from '../../../shared/concurrency.js';
import { resolveRuntimeEnv } from '../../../shared/runtime-envelope.js';
import { spawnSubprocess } from '../../../shared/subprocess.js';
import { buildTreeSitterSchedulerPlan } from './plan.js';
import { createTreeSitterSchedulerLookup } from './lookup.js';
import {
  loadTreeSitterSchedulerAdaptiveProfile,
  mergeTreeSitterSchedulerAdaptiveProfile,
  saveTreeSitterSchedulerAdaptiveProfile
} from './adaptive-profile.js';

const SCHEDULER_EXEC_PATH = fileURLToPath(new URL('./subprocess-exec.js', import.meta.url));
const INDEX_LOAD_RETRY_ATTEMPTS = 8;
const INDEX_LOAD_RETRY_BASE_DELAY_MS = 25;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const resolveExecConcurrency = ({ schedulerConfig, grammarCount }) => {
  if (!Number.isFinite(grammarCount) || grammarCount <= 1) return 1;
  const configured = Number(
    schedulerConfig?.execConcurrency
      ?? schedulerConfig?.subprocessConcurrency
      ?? schedulerConfig?.concurrency
  );
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(1, Math.min(grammarCount, Math.floor(configured)));
  }
  const available = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : 4;
  const auto = Math.max(1, Math.min(8, Math.floor((available || 1) / 2)));
  return Math.max(1, Math.min(grammarCount, auto));
};

/**
 * Resolve deterministic execution order for scheduler tasks.
 *
 * Newer plans provide `executionOrder`; older plans only include `grammarKeys`.
 * We preserve backward compatibility by falling back to `grammarKeys` and
 * always returning a copy so callers can mutate safely.
 *
 * @param {{executionOrder?:string[],grammarKeys?:string[]}} [plan]
 * @returns {string[]}
 */
const resolveExecutionOrder = (plan = {}) => {
  const executionOrder = Array.isArray(plan?.executionOrder) ? plan.executionOrder : [];
  if (executionOrder.length) return executionOrder.slice();
  const grammarKeys = Array.isArray(plan?.grammarKeys) ? plan.grammarKeys : [];
  return grammarKeys.slice();
};

const resolveWarmPoolLaneCount = ({
  schedulerConfig,
  baseGrammarKey,
  keyCount,
  execConcurrency
}) => {
  if (!Number.isFinite(keyCount) || keyCount <= 1) return 1;
  const perGrammarRaw = Number(
    schedulerConfig?.warmPoolPerGrammar
      ?? schedulerConfig?.parserWarmPoolPerGrammar
      ?? schedulerConfig?.warmPools?.[baseGrammarKey]
  );
  if (Number.isFinite(perGrammarRaw) && perGrammarRaw > 0) {
    return Math.max(1, Math.min(keyCount, Math.floor(perGrammarRaw)));
  }
  if (keyCount < 4) return 1;
  const byConcurrency = Number.isFinite(execConcurrency) && execConcurrency > 0
    ? Math.max(1, Math.floor(execConcurrency / 2))
    : 1;
  const heuristic = keyCount >= 12 ? 3 : 2;
  return Math.max(1, Math.min(keyCount, byConcurrency, heuristic));
};

/**
 * Build per-grammar warm-pool tasks by partitioning ordered wave keys into a
 * small number of long-lived subprocess lanes.
 *
 * @param {object} input
 * @returns {Array<{taskId:string,baseGrammarKey:string,laneIndex:number,laneCount:number,grammarKeys:Array<string>,firstOrder:number}>}
 */
const buildWarmPoolTasks = ({
  executionOrder,
  groupMetaByGrammarKey,
  schedulerConfig,
  execConcurrency
}) => {
  const byBaseGrammar = new Map();
  const order = Array.isArray(executionOrder) ? executionOrder : [];
  for (let i = 0; i < order.length; i += 1) {
    const grammarKey = order[i];
    if (typeof grammarKey !== 'string' || !grammarKey) continue;
    const groupMeta = groupMetaByGrammarKey?.[grammarKey] || {};
    const baseGrammarKey = typeof groupMeta?.baseGrammarKey === 'string' && groupMeta.baseGrammarKey
      ? groupMeta.baseGrammarKey
      : grammarKey;
    if (!byBaseGrammar.has(baseGrammarKey)) byBaseGrammar.set(baseGrammarKey, []);
    byBaseGrammar.get(baseGrammarKey).push({ grammarKey, orderIndex: i });
  }
  const tasks = [];
  for (const [baseGrammarKey, keyed] of byBaseGrammar.entries()) {
    const laneCount = resolveWarmPoolLaneCount({
      schedulerConfig,
      baseGrammarKey,
      keyCount: keyed.length,
      execConcurrency
    });
    const lanes = Array.from({ length: laneCount }, () => []);
    for (let i = 0; i < keyed.length; i += 1) {
      lanes[i % laneCount].push(keyed[i]);
    }
    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
      const lane = lanes[laneIndex];
      if (!lane.length) continue;
      tasks.push({
        taskId: `${baseGrammarKey}#pool${laneIndex + 1}`,
        baseGrammarKey,
        laneIndex: laneIndex + 1,
        laneCount,
        grammarKeys: lane.map((entry) => entry.grammarKey),
        firstOrder: lane.reduce((min, entry) => Math.min(min, entry.orderIndex), Number.POSITIVE_INFINITY)
      });
    }
  }
  tasks.sort((a, b) => {
    if (a.firstOrder !== b.firstOrder) return a.firstOrder - b.firstOrder;
    return String(a.taskId).localeCompare(String(b.taskId));
  });
  return tasks;
};

const loadSubprocessProfile = async (profilePath) => {
  if (!profilePath) return [];
  try {
    const raw = JSON.parse(await fs.readFile(profilePath, 'utf8'));
    const fields = raw?.fields && typeof raw.fields === 'object' ? raw.fields : raw;
    const rows = Array.isArray(fields?.rows) ? fields.rows : [];
    return rows.filter((row) => row && typeof row === 'object');
  } catch {
    return [];
  } finally {
    try { await fs.rm(profilePath, { force: true }); } catch {}
  }
};

/**
 * Buffer chunked subprocess output into complete lines.
 *
 * Child process stream chunks can split lines arbitrarily. We only forward
 * complete lines to the parent logger so progress rendering stays stable and
 * does not interleave partial fragments with TTY redraw output.
 *
 * @param {(line: string) => void} onLine
 * @returns {{ push: (text: string) => void, flush: () => void }}
 */
const createLineBuffer = (onLine) => {
  let buffer = '';
  return {
    push(text) {
      buffer += String(text || '');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        onLine(trimmed);
      }
    },
    flush() {
      const trimmed = buffer.trim();
      if (trimmed) onLine(trimmed);
      buffer = '';
    }
  };
};

const buildPlannedSegmentsByContainer = (groups) => {
  const byContainer = new Map();
  const seen = new Map();
  const entries = Array.isArray(groups) ? groups : [];
  for (const group of entries) {
    const jobs = Array.isArray(group?.jobs) ? group.jobs : [];
    for (const job of jobs) {
      const containerPath = typeof job?.containerPath === 'string' ? job.containerPath : null;
      const segment = job?.segment && typeof job.segment === 'object' ? job.segment : null;
      if (!containerPath || !segment) continue;
      const start = Number(segment.start);
      const end = Number(segment.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
      const segmentUid = segment.segmentUid || null;
      const dedupeKey = `${containerPath}|${segmentUid || ''}|${start}:${end}`;
      if (seen.has(dedupeKey)) continue;
      seen.set(dedupeKey, true);
      const target = byContainer.get(containerPath) || [];
      target.push({
        ...segment,
        start,
        end
      });
      byContainer.set(containerPath, target);
    }
  }
  for (const segments of byContainer.values()) {
    segments.sort((a, b) => (a.start - b.start) || (a.end - b.end));
  }
  return byContainer;
};

const parseIndexRows = (text, indexPath) => {
  const rows = new Map();
  let invalidRows = 0;
  const validateRow = (row) => {
    if (!row || typeof row !== 'object') return false;
    if (typeof row.virtualPath !== 'string' || !row.virtualPath) return false;
    if (typeof row.grammarKey !== 'string' || !row.grammarKey) return false;
    if (row.store === 'paged-json') {
      const page = Number(row.page);
      const item = Number(row.row);
      const pageOffset = Number(row.pageOffset);
      const pageBytes = Number(row.pageBytes);
      return Number.isFinite(page)
        && page >= 0
        && Number.isFinite(item)
        && item >= 0
        && Number.isFinite(pageOffset)
        && pageOffset >= 0
        && Number.isFinite(pageBytes)
        && pageBytes > 0;
    }
    const offset = Number(row.offset);
    const bytes = Number(row.bytes);
    return Number.isFinite(offset)
      && offset >= 0
      && Number.isFinite(bytes)
      && bytes > 0;
  };
  const lines = String(text || '').split(/\r?\n/);
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const raw = lines[lineNumber];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let row = null;
    try {
      row = JSON.parse(trimmed);
    } catch (err) {
      invalidRows += 1;
      continue;
    }
    if (!validateRow(row)) {
      invalidRows += 1;
      continue;
    }
    rows.set(row.virtualPath, row);
  }
  if (invalidRows > 0) {
    const err = new Error(
      `[tree-sitter:schedule] invalid index rows in ${indexPath} (invalid=${invalidRows}, valid=${rows.size})`
    );
    err.code = 'ERR_TREE_SITTER_INDEX_PARSE';
    throw err;
  }
  return rows;
};

const readIndexRowsWithRetry = async ({ indexPath, abortSignal = null }) => {
  let lastError = null;
  for (let attempt = 0; attempt < INDEX_LOAD_RETRY_ATTEMPTS; attempt += 1) {
    throwIfAborted(abortSignal);
    try {
      const text = await fs.readFile(indexPath, 'utf8');
      return parseIndexRows(text, indexPath);
    } catch (err) {
      lastError = err;
      const retryable = err?.code === 'ENOENT' || err?.code === 'ERR_TREE_SITTER_INDEX_PARSE';
      if (!retryable || attempt >= INDEX_LOAD_RETRY_ATTEMPTS - 1) {
        throw err;
      }
      await sleep(INDEX_LOAD_RETRY_BASE_DELAY_MS * (attempt + 1));
    }
  }
  throw lastError || new Error(`[tree-sitter:schedule] failed to load index rows: ${indexPath}`);
};

const loadIndexEntries = async ({ grammarKeys, paths, abortSignal = null }) => {
  throwIfAborted(abortSignal);
  const index = new Map();
  const keys = Array.isArray(grammarKeys) ? grammarKeys : [];
  const rowMaps = await runWithConcurrency(
    keys,
    Math.max(1, Math.min(8, keys.length || 1)),
    async (grammarKey) => {
      throwIfAborted(abortSignal);
      const indexPath = paths.resultsIndexPathForGrammarKey(grammarKey);
      return readIndexRowsWithRetry({ indexPath, abortSignal });
    },
    { signal: abortSignal }
  );
  for (const rows of rowMaps || []) {
    if (!(rows instanceof Map)) continue;
    for (const [virtualPath, row] of rows.entries()) {
      throwIfAborted(abortSignal);
      index.set(virtualPath, row);
    }
  }
  return index;
};

/**
 * Execute tree-sitter scheduling for a mode by planning per-grammar jobs,
 * running the scheduler subprocess(es), and loading the merged index rows.
 *
 * @param {object} input
 * @param {'code'|'prose'|'records'|'extracted-prose'} input.mode
 * @param {object} input.runtime
 * @param {Array<object>} input.entries
 * @param {string} input.outDir
 * @param {object|null} [input.fileTextCache]
 * @param {AbortSignal|null} [input.abortSignal]
 * @param {(line:string)=>void|null} [input.log]
 * @returns {Promise<object|null>}
 */
export const runTreeSitterScheduler = async ({
  mode,
  runtime,
  entries,
  outDir,
  fileTextCache = null,
  abortSignal = null,
  log = null
}) => {
  throwIfAborted(abortSignal);
  const schedulerConfig = runtime?.languageOptions?.treeSitter?.scheduler || {};
  const requestedTransport = typeof schedulerConfig.transport === 'string'
    ? schedulerConfig.transport.trim().toLowerCase()
    : 'disk';
  const requestedSharedCache = schedulerConfig.sharedCache === true;
  if (requestedTransport === 'shm' && log) {
    log('[tree-sitter:schedule] scheduler transport=shm requested; falling back to disk transport.');
  }
  if (requestedSharedCache && log) {
    log(
      '[tree-sitter:schedule] scheduler sharedCache requested; ' +
      'paged cross-process cache is not enabled, using process-local cache.'
    );
  }
  const planResult = await buildTreeSitterSchedulerPlan({
    mode,
    runtime,
    entries,
    outDir,
    fileTextCache,
    abortSignal,
    log
  });
  if (!planResult) return null;

  // Execute the plan in a separate Node process to isolate parser memory churn
  // from the main indexer process.
  const runtimeEnv = runtime?.envelope
    ? resolveRuntimeEnv(runtime.envelope, process.env)
    : process.env;
  const executionOrder = resolveExecutionOrder(planResult.plan);
  const grammarKeys = Array.isArray(planResult.plan?.grammarKeys) && planResult.plan.grammarKeys.length
    ? planResult.plan.grammarKeys
    : executionOrder.slice();
  const groupMetaByGrammarKey = planResult.plan?.groupMeta && typeof planResult.plan.groupMeta === 'object'
    ? planResult.plan.groupMeta
    : {};
  const idleGapStats = {
    samples: 0,
    totalMs: 0,
    maxMs: 0,
    thresholdMs: 25
  };
  let lastTaskCompletedAt = 0;
  if (executionOrder.length) {
    const streamLogs = typeof log === 'function';
    const execConcurrency = resolveExecConcurrency({
      schedulerConfig,
      grammarCount: executionOrder.length
    });
    const warmPoolTasks = buildWarmPoolTasks({
      executionOrder,
      groupMetaByGrammarKey,
      schedulerConfig,
      execConcurrency
    });
    const adaptiveSamples = [];
    await runWithConcurrency(
      warmPoolTasks,
      execConcurrency,
      async (task, ctx) => {
        throwIfAborted(abortSignal);
        const now = Date.now();
        if (lastTaskCompletedAt > 0) {
          const idleGapMs = Math.max(0, now - lastTaskCompletedAt);
          if (idleGapMs >= idleGapStats.thresholdMs) {
            idleGapStats.samples += 1;
            idleGapStats.totalMs += idleGapMs;
            idleGapStats.maxMs = Math.max(idleGapStats.maxMs, idleGapMs);
          }
        }
        const grammarKeysForTask = Array.isArray(task?.grammarKeys) ? task.grammarKeys : [];
        if (!grammarKeysForTask.length) return;
        if (log) {
          log(
            `[tree-sitter:schedule] exec ${ctx.index + 1}/${warmPoolTasks.length}: ${task.taskId} `
            + `(waves=${grammarKeysForTask.length}, lane=${task.laneIndex}/${task.laneCount})`
          );
        }
        const linePrefix = `[tree-sitter:schedule:${task.taskId}]`;
        const stdoutBuffer = streamLogs
          ? createLineBuffer((line) => log(`${linePrefix} ${line}`))
          : null;
        const stderrBuffer = streamLogs
          ? createLineBuffer((line) => log(`${linePrefix} ${line}`))
          : null;
        const profileOut = path.join(
          outDir,
          `.tree-sitter-scheduler-profile-${process.pid}-${ctx.index + 1}.json`
        );
        try {
          // Avoid stdio='inherit' when we have a logger. Direct child writes bypass
          // the display/progress handlers and render underneath interactive bars.
          // Piping and relaying lines keeps all output on the parent render path.
          await spawnSubprocess(
            process.execPath,
            [
              SCHEDULER_EXEC_PATH,
              '--outDir', outDir,
              '--grammarKeys', grammarKeysForTask.join(','),
              '--profileOut', profileOut
            ],
            {
              cwd: runtime?.root || undefined,
              env: runtimeEnv,
              stdio: streamLogs ? ['ignore', 'pipe', 'pipe'] : 'inherit',
              shell: false,
              signal: abortSignal,
              killTree: true,
              rejectOnNonZeroExit: true,
              onStdout: streamLogs ? (chunk) => stdoutBuffer.push(chunk) : null,
              onStderr: streamLogs ? (chunk) => stderrBuffer.push(chunk) : null
            }
          );
          const profileRows = await loadSubprocessProfile(profileOut);
          for (const row of profileRows) {
            adaptiveSamples.push(row);
          }
        } finally {
          stdoutBuffer?.flush();
          stderrBuffer?.flush();
          lastTaskCompletedAt = Date.now();
        }
        throwIfAborted(abortSignal);
      },
      { collectResults: false, signal: abortSignal }
    );
    if (adaptiveSamples.length) {
      const loaded = await loadTreeSitterSchedulerAdaptiveProfile({
        runtime,
        treeSitterConfig: runtime?.languageOptions?.treeSitter || null,
        log
      });
      const merged = mergeTreeSitterSchedulerAdaptiveProfile(loaded.entriesByGrammarKey, adaptiveSamples);
      await saveTreeSitterSchedulerAdaptiveProfile({
        profilePath: loaded.profilePath,
        entriesByGrammarKey: merged,
        log
      });
    }
    throwIfAborted(abortSignal);
  }

  throwIfAborted(abortSignal);
  const index = await loadIndexEntries({
    grammarKeys,
    paths: planResult.paths,
    abortSignal
  });
  const lookup = createTreeSitterSchedulerLookup({
    outDir,
    index,
    log
  });
  const plannedSegmentsByContainer = buildPlannedSegmentsByContainer(planResult.groups);

  return {
    ...lookup,
    plan: planResult.plan,
    plannedSegmentsByContainer,
    loadPlannedSegments: (containerPath) => {
      if (!containerPath || !plannedSegmentsByContainer.has(containerPath)) return null;
      const segments = plannedSegmentsByContainer.get(containerPath);
      return Array.isArray(segments) ? segments.map((segment) => ({ ...segment })) : null;
    },
    schedulerStats: planResult.plan
      ? {
        grammarKeys: (planResult.plan.grammarKeys || []).length,
        jobs: planResult.plan.jobs || 0,
        parserQueueIdleGaps: {
          samples: idleGapStats.samples,
          totalMs: idleGapStats.totalMs,
          maxMs: idleGapStats.maxMs,
          avgMs: idleGapStats.samples > 0 ? Math.round(idleGapStats.totalMs / idleGapStats.samples) : 0
        }
      }
      : null
  };
};

export const treeSitterSchedulerRunnerInternals = Object.freeze({
  resolveExecutionOrder,
  buildWarmPoolTasks
});
