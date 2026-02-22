import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { throwIfAborted } from '../../../shared/abort.js';
import { runWithConcurrency } from '../../../shared/concurrency.js';
import { resolveRuntimeEnv } from '../../../shared/runtime-envelope.js';
import { spawnSubprocess } from '../../../shared/subprocess.js';
import { sha1 } from '../../../shared/hash.js';
import { NATIVE_GRAMMAR_MODULES } from '../../../lang/tree-sitter/native-runtime.js';
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
const TREE_SITTER_RUNTIME_PACKAGE = 'tree-sitter';
const SUBPROCESS_CRASH_PREFIX = '[tree-sitter:schedule] crash-event ';
const SUBPROCESS_INJECTED_CRASH_PREFIX = '[tree-sitter:schedule] injected-crash ';
const CRASH_BUNDLE_SCHEMA_VERSION = '1.0.0';
const CRASH_BUNDLE_FILE = 'crash-forensics.json';
const DEFAULT_DURABLE_DIR = '_crash-forensics';
const require = createRequire(import.meta.url);
const packageVersionCache = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sanitizePathToken = (value, fallback = 'unknown') => {
  const raw = value == null ? '' : String(value);
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const cleaned = trimmed.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return cleaned || fallback;
};

const readPackageVersion = (packageName) => {
  if (typeof packageName !== 'string' || !packageName.trim()) return null;
  const normalized = packageName.trim();
  if (packageVersionCache.has(normalized)) {
    return packageVersionCache.get(normalized);
  }
  let version = null;
  try {
    const pkgPath = require.resolve(`${normalized}/package.json`);
    const pkg = require(pkgPath);
    const parsed = typeof pkg?.version === 'string' ? pkg.version.trim() : '';
    version = parsed || null;
  } catch {
    version = null;
  }
  packageVersionCache.set(normalized, version);
  return version;
};

const parseSubprocessCrashEvents = (error) => {
  const stderr = String(error?.result?.stderr || '');
  if (!stderr.trim()) return [];
  const out = [];
  const lines = stderr.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const prefixes = [SUBPROCESS_CRASH_PREFIX, SUBPROCESS_INJECTED_CRASH_PREFIX];
    let payload = null;
    for (const prefix of prefixes) {
      if (!trimmed.startsWith(prefix)) continue;
      payload = trimmed.slice(prefix.length).trim();
      break;
    }
    if (!payload) continue;
    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed === 'object') out.push(parsed);
    } catch {}
  }
  return out;
};

const resolveParserMetadata = (languageId) => {
  const normalizedLanguage = typeof languageId === 'string' && languageId
    ? languageId
    : null;
  const grammarSpec = normalizedLanguage ? NATIVE_GRAMMAR_MODULES?.[normalizedLanguage] : null;
  const grammarModule = typeof grammarSpec?.moduleName === 'string' ? grammarSpec.moduleName : null;
  return {
    provider: 'tree-sitter-native',
    languageId: normalizedLanguage,
    grammarModule,
    grammarVersion: grammarModule ? readPackageVersion(grammarModule) : null,
    parserRuntime: TREE_SITTER_RUNTIME_PACKAGE,
    parserRuntimeVersion: readPackageVersion(TREE_SITTER_RUNTIME_PACKAGE),
    parserAbi: process.versions?.modules || null,
    parserNapi: process.versions?.napi || null
  };
};

const resolveFirstFailedJob = (group) => {
  const jobs = Array.isArray(group?.jobs) ? group.jobs : [];
  if (!jobs.length) return null;
  return jobs[0];
};

const resolveFileFingerprint = (job) => {
  const signature = job?.fileVersionSignature && typeof job.fileVersionSignature === 'object'
    ? job.fileVersionSignature
    : null;
  const hash = typeof signature?.hash === 'string' ? signature.hash : null;
  const size = Number(signature?.size);
  const mtimeMs = Number(signature?.mtimeMs);
  return {
    hash,
    size: Number.isFinite(size) ? size : null,
    mtimeMs: Number.isFinite(mtimeMs) ? mtimeMs : null
  };
};

const buildCrashSignature = ({
  parserMetadata,
  grammarKey,
  fileFingerprint,
  stage,
  exitCode,
  signal
}) => {
  const payload = [
    parserMetadata?.provider || '',
    parserMetadata?.languageId || '',
    parserMetadata?.parserAbi || '',
    parserMetadata?.grammarModule || '',
    parserMetadata?.grammarVersion || '',
    parserMetadata?.parserRuntimeVersion || '',
    grammarKey || '',
    fileFingerprint?.hash || '',
    fileFingerprint?.size ?? '',
    stage || '',
    Number.isFinite(exitCode) ? String(exitCode) : '',
    signal || ''
  ].join('|');
  return `tscrash:${sha1(payload).slice(0, 20)}`;
};

const resolveDurableCrashBundlePath = ({ runtime, outDir }) => {
  const repoCacheRoot = typeof runtime?.repoCacheRoot === 'string' && runtime.repoCacheRoot
    ? path.resolve(runtime.repoCacheRoot)
    : null;
  const baseDir = repoCacheRoot ? path.dirname(repoCacheRoot) : null;
  if (!baseDir) return null;
  const buildToken = sanitizePathToken(runtime?.buildId || path.basename(outDir || ''), 'build');
  const repoToken = sanitizePathToken(path.basename(repoCacheRoot), 'repo');
  const durableDir = path.join(baseDir, DEFAULT_DURABLE_DIR);
  return path.join(durableDir, `${repoToken}-${buildToken}-${CRASH_BUNDLE_FILE}`);
};

const makeBundleSnapshot = ({
  runtime,
  outDir,
  eventsBySignature,
  failedGrammarKeys,
  degradedVirtualPaths
}) => ({
  schemaVersion: CRASH_BUNDLE_SCHEMA_VERSION,
  generatedAt: new Date().toISOString(),
  repoRoot: runtime?.root || null,
  repoCacheRoot: runtime?.repoCacheRoot || null,
  buildRoot: runtime?.buildRoot || null,
  outDir: path.resolve(outDir),
  failedGrammarKeys: Array.from(failedGrammarKeys).sort(),
  degradedVirtualPaths: Array.from(degradedVirtualPaths).sort(),
  events: Array.from(eventsBySignature.values())
    .sort((a, b) => String(a.signature).localeCompare(String(b.signature)))
});

const createSchedulerCrashTracker = ({
  runtime,
  outDir,
  paths,
  groupByGrammarKey,
  crashLogger = null,
  log = null
}) => {
  const eventsBySignature = new Map();
  const failedGrammarKeys = new Set();
  const degradedVirtualPaths = new Set();
  const localBundlePath = path.join(paths.baseDir, CRASH_BUNDLE_FILE);
  const durableBundlePath = resolveDurableCrashBundlePath({ runtime, outDir });
  let persistSerial = Promise.resolve();

  const enqueuePersist = (bundle) => {
    persistSerial = persistSerial.then(async () => {
      await fs.mkdir(path.dirname(localBundlePath), { recursive: true });
      await fs.writeFile(localBundlePath, JSON.stringify(bundle, null, 2), 'utf8');
      if (durableBundlePath) {
        await fs.mkdir(path.dirname(durableBundlePath), { recursive: true });
        await fs.writeFile(durableBundlePath, JSON.stringify(bundle, null, 2), 'utf8');
      }
      if (typeof crashLogger?.persistForensicBundle === 'function') {
        const bundleSignature = `scheduler-${sha1(JSON.stringify({
          failedGrammarKeys: bundle?.failedGrammarKeys || [],
          degradedVirtualPaths: bundle?.degradedVirtualPaths || [],
          signatures: Array.isArray(bundle?.events)
            ? bundle.events.map((event) => event?.signature || '').filter(Boolean).sort()
            : []
        })).slice(0, 20)}`;
        await crashLogger.persistForensicBundle({
          kind: 'tree-sitter-scheduler-crash',
          signature: bundleSignature,
          bundle
        });
      }
    }).catch(() => {});
    return persistSerial;
  };

  const addFailedGrammarVirtualPaths = (grammarKey) => {
    const group = groupByGrammarKey.get(grammarKey);
    const jobs = Array.isArray(group?.jobs) ? group.jobs : [];
    for (const job of jobs) {
      const virtualPath = typeof job?.virtualPath === 'string' ? job.virtualPath : null;
      if (virtualPath) degradedVirtualPaths.add(virtualPath);
    }
  };

  const recordFailure = async ({
    grammarKey,
    stage,
    error,
    taskId = null,
    markFailed = true
  }) => {
    if (!grammarKey) return;
    if (markFailed) {
      failedGrammarKeys.add(grammarKey);
      addFailedGrammarVirtualPaths(grammarKey);
    }
    const group = groupByGrammarKey.get(grammarKey) || null;
    const firstJob = resolveFirstFailedJob(group);
    const languageId = typeof firstJob?.languageId === 'string' && firstJob.languageId
      ? firstJob.languageId
      : (Array.isArray(group?.languages) ? group.languages[0] : null);
    const parserMetadata = resolveParserMetadata(languageId);
    const fileFingerprint = resolveFileFingerprint(firstJob);
    const subprocessCrashEvents = parseSubprocessCrashEvents(error);
    const firstSubprocessEvent = subprocessCrashEvents[0] || null;
    const exitCode = Number(error?.result?.exitCode);
    const signal = typeof error?.result?.signal === 'string' ? error.result.signal : null;
    const resolvedStage = typeof stage === 'string' && stage
      ? stage
      : (typeof firstSubprocessEvent?.stage === 'string' ? firstSubprocessEvent.stage : 'scheduler-subprocess');
    const signature = buildCrashSignature({
      parserMetadata,
      grammarKey,
      fileFingerprint,
      stage: resolvedStage,
      exitCode,
      signal
    });
    const existing = eventsBySignature.get(signature);
    if (existing) {
      existing.occurrences += 1;
      existing.lastSeenAt = new Date().toISOString();
      if (taskId) existing.taskIds = Array.from(new Set([...(existing.taskIds || []), taskId]));
    } else {
      const event = {
        schemaVersion: CRASH_BUNDLE_SCHEMA_VERSION,
        signature,
        occurrences: 1,
        firstSeenAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        stage: resolvedStage,
        grammarKey,
        parser: parserMetadata,
        file: {
          containerPath: firstJob?.containerPath || null,
          virtualPath: firstJob?.virtualPath || null,
          size: fileFingerprint.size,
          mtimeMs: fileFingerprint.mtimeMs,
          fingerprintHash: fileFingerprint.hash
        },
        subprocess: {
          exitCode: Number.isFinite(exitCode) ? exitCode : null,
          signal,
          durationMs: Number.isFinite(Number(error?.result?.durationMs))
            ? Number(error.result.durationMs)
            : null
        },
        taskIds: taskId ? [taskId] : [],
        errorMessage: error?.message || String(error),
        subprocessEvents: subprocessCrashEvents
      };
      eventsBySignature.set(signature, event);
      if (typeof log === 'function') {
        log(
          `[tree-sitter:schedule] parser crash contained (${grammarKey}); signature=${signature} ` +
          `stage=${resolvedStage} lang=${parserMetadata.languageId || 'unknown'}`
        );
      }
      if (crashLogger?.enabled) {
        crashLogger.logError({
          category: 'parse',
          phase: 'tree-sitter-scheduler',
          stage: resolvedStage,
          file: firstJob?.containerPath || null,
          languageId: parserMetadata.languageId || null,
          grammarKey,
          signature,
          message: error?.message || String(error),
          parser: parserMetadata,
          subprocess: {
            exitCode: Number.isFinite(exitCode) ? exitCode : null,
            signal
          }
        });
      }
    }
    const bundle = makeBundleSnapshot({
      runtime,
      outDir,
      eventsBySignature,
      failedGrammarKeys,
      degradedVirtualPaths
    });
    void enqueuePersist(bundle);
  };

  return {
    recordFailure,
    getFailedGrammarKeys: () => new Set(failedGrammarKeys),
    getDegradedVirtualPaths: () => new Set(degradedVirtualPaths),
    getBundlePath: () => localBundlePath,
    getDurableBundlePath: () => durableBundlePath,
    summarize: () => ({
      parserCrashSignatures: eventsBySignature.size,
      parserCrashEvents: Array.from(eventsBySignature.values())
        .sort((a, b) => String(a.signature).localeCompare(String(b.signature))),
      failedGrammarKeys: Array.from(failedGrammarKeys).sort(),
      degradedVirtualPaths: Array.from(degradedVirtualPaths).sort()
    }),
    waitForPersistence: async () => {
      try {
        await persistSerial;
      } catch {}
    }
  };
};

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
 * `executionOrder` is the canonical scheduler plan contract. Missing or empty
 * execution order indicates stale/corrupt plan artifacts and must fail closed,
 * except for empty no-op plans that schedule no grammar work.
 *
 * @param {{executionOrder?:string[]}} [plan]
 * @returns {string[]}
 */
const resolveExecutionOrder = (plan = {}) => {
  const executionOrder = Array.isArray(plan?.executionOrder) ? plan.executionOrder : [];
  if (executionOrder.length) {
    return executionOrder.slice();
  }
  const grammarKeys = Array.isArray(plan?.grammarKeys)
    ? plan.grammarKeys.filter((key) => typeof key === 'string' && key)
    : [];
  const plannedJobsRaw = Number(plan?.jobs);
  const hasPlannedJobs = Number.isFinite(plannedJobsRaw) ? plannedJobsRaw > 0 : false;
  if (!grammarKeys.length && !hasPlannedJobs) {
    return [];
  }
  throw new Error(
    '[tree-sitter:schedule] scheduler plan missing executionOrder; rebuild scheduler artifacts.'
  );
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
  let heuristic = 2;
  if (keyCount >= 64) {
    heuristic = 8;
  } else if (keyCount >= 32) {
    heuristic = 6;
  } else if (keyCount >= 16) {
    heuristic = 4;
  } else if (keyCount >= 8) {
    heuristic = 3;
  }
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

const buildScheduledLanguageSet = (groups) => {
  const scheduled = new Set();
  const entries = Array.isArray(groups) ? groups : [];
  for (const group of entries) {
    const languages = Array.isArray(group?.languages) ? group.languages : [];
    for (const languageId of languages) {
      if (typeof languageId !== 'string' || !languageId) continue;
      scheduled.add(languageId);
    }
  }
  return scheduled;
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
 * @param {object|null} [input.crashLogger]
 * @returns {Promise<object|null>}
 */
export const runTreeSitterScheduler = async ({
  mode,
  runtime,
  entries,
  outDir,
  fileTextCache = null,
  abortSignal = null,
  log = null,
  crashLogger = null
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
  const grammarKeys = Array.from(new Set(executionOrder));
  const groupMetaByGrammarKey = planResult.plan?.groupMeta && typeof planResult.plan.groupMeta === 'object'
    ? planResult.plan.groupMeta
    : {};
  const groupByGrammarKey = new Map();
  for (const group of planResult.groups || []) {
    if (!group?.grammarKey) continue;
    groupByGrammarKey.set(group.grammarKey, group);
  }
  const crashTracker = createSchedulerCrashTracker({
    runtime,
    outDir,
    paths: planResult.paths,
    groupByGrammarKey,
    crashLogger,
    log
  });
  const idleGapStats = {
    samples: 0,
    totalMs: 0,
    maxMs: 0,
    thresholdMs: 25
  };
  let lastTaskCompletedAt = 0;
  if (executionOrder.length) {
    const streamLogs = typeof log === 'function'
      && (runtime?.argv?.verbose === true || runtime?.languageOptions?.treeSitter?.debugScheduler === true);
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
            `[tree-sitter:schedule] batch ${ctx.index + 1}/${warmPoolTasks.length}: ${task.taskId} `
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
              stdio: ['ignore', 'pipe', 'pipe'],
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
        } catch (err) {
          if (abortSignal?.aborted) throw err;
          const subprocessCrashEvents = parseSubprocessCrashEvents(err);
          const exitCode = Number(err?.result?.exitCode);
          const containsCrashEvent = subprocessCrashEvents.length > 0 || exitCode === 86;
          if (!containsCrashEvent) throw err;
          const crashStage = typeof subprocessCrashEvents[0]?.stage === 'string'
            ? subprocessCrashEvents[0].stage
            : 'scheduler-subprocess';
          for (const grammarKey of grammarKeysForTask) {
            await crashTracker.recordFailure({
              grammarKey,
              stage: crashStage,
              error: err,
              taskId: task.taskId,
              markFailed: true
            });
          }
          return;
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
  await crashTracker.waitForPersistence();
  const crashSummary = crashTracker.summarize();
  const failedGrammarKeySet = new Set(crashSummary.failedGrammarKeys);
  const successfulGrammarKeys = grammarKeys.filter((grammarKey) => !failedGrammarKeySet.has(grammarKey));
  const degradedVirtualPathSet = new Set(crashSummary.degradedVirtualPaths);
  if (crashSummary.parserCrashSignatures > 0 && log) {
    log(
      `[tree-sitter:schedule] degraded parser mode enabled: ` +
      `signatures=${crashSummary.parserCrashSignatures} ` +
      `failedGrammarKeys=${crashSummary.failedGrammarKeys.length} ` +
      `degradedVirtualPaths=${crashSummary.degradedVirtualPaths.length}`
    );
  }

  throwIfAborted(abortSignal);
  const index = await loadIndexEntries({
    grammarKeys: successfulGrammarKeys,
    paths: planResult.paths,
    abortSignal
  });
  const lookup = createTreeSitterSchedulerLookup({
    outDir,
    index,
    log
  });
  const plannedSegmentsByContainer = buildPlannedSegmentsByContainer(planResult.groups);
  const scheduledLanguageIds = buildScheduledLanguageSet(planResult.groups);
  const baseLookupStats = typeof lookup.stats === 'function' ? lookup.stats.bind(lookup) : null;
  const scheduleStats = planResult.plan
    ? {
      grammarKeys: grammarKeys.length,
      successfulGrammarKeys: successfulGrammarKeys.length,
      failedGrammarKeys: crashSummary.failedGrammarKeys.length,
      jobs: planResult.plan.jobs || 0,
      parserQueueIdleGaps: {
        samples: idleGapStats.samples,
        totalMs: idleGapStats.totalMs,
        maxMs: idleGapStats.maxMs,
        avgMs: idleGapStats.samples > 0 ? Math.round(idleGapStats.totalMs / idleGapStats.samples) : 0
      },
      parserCrashSignatures: crashSummary.parserCrashSignatures,
      degradedVirtualPaths: crashSummary.degradedVirtualPaths.length
    }
    : null;

  return {
    ...lookup,
    plan: planResult.plan,
    scheduledLanguageIds,
    failedGrammarKeys: crashSummary.failedGrammarKeys,
    degradedVirtualPaths: crashSummary.degradedVirtualPaths,
    parserCrashEvents: crashSummary.parserCrashEvents,
    parserCrashSignatures: crashSummary.parserCrashSignatures,
    crashForensicsBundlePath: crashTracker.getBundlePath(),
    durableCrashForensicsBundlePath: crashTracker.getDurableBundlePath(),
    getCrashSummary: () => ({
      parserCrashSignatures: crashSummary.parserCrashSignatures,
      parserCrashEvents: crashSummary.parserCrashEvents.map((event) => ({ ...event })),
      failedGrammarKeys: crashSummary.failedGrammarKeys.slice(),
      degradedVirtualPaths: crashSummary.degradedVirtualPaths.slice()
    }),
    isDegradedVirtualPath: (virtualPath) => degradedVirtualPathSet.has(virtualPath),
    plannedSegmentsByContainer,
    loadPlannedSegments: (containerPath) => {
      if (!containerPath || !plannedSegmentsByContainer.has(containerPath)) return null;
      const segments = plannedSegmentsByContainer.get(containerPath);
      return Array.isArray(segments) ? segments.map((segment) => ({ ...segment })) : null;
    },
    schedulerStats: scheduleStats,
    stats: () => ({
      ...(baseLookupStats ? baseLookupStats() : {}),
      parserCrashSignatures: crashSummary.parserCrashSignatures,
      failedGrammarKeys: crashSummary.failedGrammarKeys.length,
      degradedVirtualPaths: crashSummary.degradedVirtualPaths.length
    })
  };
};

export const treeSitterSchedulerRunnerInternals = Object.freeze({
  resolveExecutionOrder,
  buildWarmPoolTasks
});
