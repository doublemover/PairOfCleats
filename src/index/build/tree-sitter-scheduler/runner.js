import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { throwIfAborted } from '../../../shared/abort.js';
import { resolveRuntimeEnv } from '../../../shared/runtime-envelope.js';
import { spawnSubprocess } from '../../../shared/subprocess.js';
import { buildTreeSitterSchedulerPlan } from './plan.js';
import { createTreeSitterSchedulerLookup } from './lookup.js';

const SCHEDULER_EXEC_PATH = fileURLToPath(new URL('./subprocess-exec.js', import.meta.url));
const INDEX_LOAD_RETRY_ATTEMPTS = 8;
const INDEX_LOAD_RETRY_BASE_DELAY_MS = 25;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  for (const grammarKey of grammarKeys || []) {
    throwIfAborted(abortSignal);
    const indexPath = paths.resultsIndexPathForGrammarKey(grammarKey);
    const rows = await readIndexRowsWithRetry({ indexPath, abortSignal });
    for (const [virtualPath, row] of rows.entries()) {
      throwIfAborted(abortSignal);
      index.set(virtualPath, row);
    }
  }
  return index;
};

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
  const grammarKeys = Array.isArray(planResult.plan?.grammarKeys) ? planResult.plan.grammarKeys : [];
  if (grammarKeys.length) {
    if (log) {
      log(`[tree-sitter:schedule] exec 1/1: ${grammarKeys.join(', ')}`);
    }
    await spawnSubprocess(process.execPath, [SCHEDULER_EXEC_PATH, '--outDir', outDir], {
      cwd: runtime?.root || undefined,
      env: runtimeEnv,
      stdio: 'inherit',
      shell: false,
      signal: abortSignal,
      killTree: true,
      rejectOnNonZeroExit: true
    });
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
      ? { grammarKeys: (planResult.plan.grammarKeys || []).length, jobs: planResult.plan.jobs || 0 }
      : null
  };
};
