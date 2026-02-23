#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { captureProcessSnapshot, snapshotTrackedSubprocesses, spawnSubprocess } from '../../src/shared/subprocess.js';
import { getTuiEnvConfig } from '../../src/shared/env.js';
import { applyProgressContextEnv } from '../../src/shared/progress.js';
import { createProgressLineDecoder } from '../../src/shared/cli/progress-stream.js';
import { formatProgressEvent, PROGRESS_PROTOCOL } from '../../src/shared/cli/progress-events.js';
import { resolveDispatchRequest } from '../../src/shared/dispatch/resolve.js';
import { stableStringify } from '../../src/shared/stable-json.js';
import {
  getIndexDir,
  getMetricsDir,
  getRepoCacheRoot,
  getToolVersion,
  loadUserConfig,
  resolveToolRoot
} from '../shared/dict-utils.js';

const ROOT = resolveToolRoot();
const SUPERVISOR_PROTOCOL = 'poc.tui@1';
const tuiEnvConfig = getTuiEnvConfig(process.env);
const generatedRunId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const sanitizeRunIdForFilename = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  const safe = text
    .replace(/[\x00-\x1f]+/g, '-')
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  return safe || '';
};
const runId = tuiEnvConfig.runId || generatedRunId;
const runFileId = sanitizeRunIdForFilename(runId) || generatedRunId;
const supervisorVersion = getToolVersion() || '0.0.0';

const createEventLogRecorder = () => {
  const requestedDir = tuiEnvConfig.eventLogDir;
  if (!requestedDir) return null;
  const logsDir = path.resolve(requestedDir);
  const eventLogPath = path.join(logsDir, `${runFileId}.jsonl`);
  const sessionMetaPath = path.join(logsDir, `${runFileId}.meta.json`);
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    const meta = {
      schemaVersion: 1,
      runId,
      protocol: PROGRESS_PROTOCOL,
      supervisorProtocol: SUPERVISOR_PROTOCOL,
      supervisorVersion,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      eventLogPath: path.relative(ROOT, eventLogPath).replace(/\\/g, '/')
    };
    fs.writeFileSync(sessionMetaPath, `${stableStringify(meta)}\n`, 'utf8');
  } catch (error) {
    process.stderr.write(`[supervisor] failed to initialize event log recorder: ${error?.message || error}\n`);
    return null;
  }
  let closed = false;
  return {
    eventLogPath,
    write(entry) {
      if (closed) return;
      try {
        fs.appendFileSync(eventLogPath, `${JSON.stringify(entry)}\n`, 'utf8');
      } catch (error) {
        closed = true;
        process.stderr.write(`[supervisor] disabled event log recorder: ${error?.message || error}\n`);
      }
    },
    finalize(reason = 'shutdown') {
      if (closed) return;
      closed = true;
      try {
        const metaBody = fs.readFileSync(sessionMetaPath, 'utf8');
        const existing = JSON.parse(metaBody);
        const next = {
          ...existing,
          endedAt: new Date().toISOString(),
          endReason: String(reason || 'shutdown').trim() || 'shutdown'
        };
        fs.writeFileSync(sessionMetaPath, `${stableStringify(next)}\n`, 'utf8');
      } catch {}
    }
  };
};

const eventLogRecorder = createEventLogRecorder();

const FLOW_DEFAULT_CREDITS = 512;
const FLOW_MAX_CREDITS = 10_000;
const FLOW_QUEUE_MAX = 2048;
const FLOW_MAX_EVENT_CHARS = 16 * 1024;
const FLOW_CHUNK_CHARS = 4096;
const FLOW_METRICS_INTERVAL_MS = 1000;
const CRITICAL_EVENTS = new Set(['hello', 'job:start', 'job:spawn', 'job:end', 'job:artifacts', 'runtime:metrics']);
const WATCHDOG_MAX_MS = 60 * 60 * 1000;
const WATCHDOG_SOFT_KICK_COOLDOWN_DEFAULT_MS = 10_000;
const WATCHDOG_SOFT_KICK_MAX_ATTEMPTS_DEFAULT = 2;

const state = {
  shuttingDown: false,
  shutdownStartedAt: 0,
  globalSeq: 0,
  jobs: new Map(),
  flow: {
    credits: FLOW_DEFAULT_CREDITS,
    queue: [],
    queueMax: FLOW_QUEUE_MAX,
    maxEventChars: FLOW_MAX_EVENT_CHARS,
    chunkChars: FLOW_CHUNK_CHARS,
    sent: 0,
    dropped: 0,
    coalesced: 0,
    chunked: 0,
    chunkSeq: 0
  }
};

const clampInt = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
};

const nowIso = () => new Date().toISOString();

const getJob = (jobId) => (typeof jobId === 'string' ? state.jobs.get(jobId) : null);

const nextSeq = (jobId = null) => {
  if (!jobId) {
    state.globalSeq += 1;
    return state.globalSeq;
  }
  const job = getJob(jobId);
  if (!job) {
    state.globalSeq += 1;
    return state.globalSeq;
  }
  job.seq += 1;
  return job.seq;
};

const nextChunkId = () => {
  state.flow.chunkSeq += 1;
  return `${runId}-chunk-${state.flow.chunkSeq}`;
};

const writeEvent = (entry) => {
  process.stdout.write(`${JSON.stringify(entry)}\n`);
  eventLogRecorder?.write(entry);
  state.flow.sent += 1;
};

/**
 * Enqueue a flow event with bounded-queue coalescing semantics.
 *
 * When full, progress events for the same job/task replace older entries and
 * log events preferentially evict older log entries before generic FIFO drops.
 *
 * @param {object} entry
 * @returns {void}
 */
const queueFlowEntry = (entry) => {
  const queue = state.flow.queue;
  if (queue.length < state.flow.queueMax) {
    queue.push(entry);
    return;
  }
  if (entry.event === 'task:progress') {
    const replacementIndex = queue.findLastIndex((queued) => (
      queued.event === 'task:progress'
      && queued.jobId === entry.jobId
      && queued.taskId === entry.taskId
    ));
    if (replacementIndex >= 0) {
      queue[replacementIndex] = entry;
      state.flow.coalesced += 1;
      return;
    }
  }
  if (entry.event === 'log') {
    const dropIndex = queue.findIndex((queued) => queued.event === 'log');
    if (dropIndex >= 0) {
      queue.splice(dropIndex, 1);
      state.flow.dropped += 1;
    }
  } else {
    queue.shift();
    state.flow.dropped += 1;
  }
  queue.push(entry);
};

/**
 * Flush queued flow entries while per-interval send credits remain.
 *
 * @returns {void}
 */
const drainFlowQueue = () => {
  while (state.flow.credits > 0 && state.flow.queue.length > 0) {
    const next = state.flow.queue.shift();
    if (!next) break;
    state.flow.credits -= 1;
    writeEvent(next);
  }
};

const emitEntry = (entry, { critical = false } = {}) => {
  if (critical || state.flow.credits > 0) {
    if (!critical) {
      state.flow.credits = Math.max(0, state.flow.credits - 1);
    }
    writeEvent(entry);
    return;
  }
  queueFlowEntry(entry);
};

const splitEventPayloadIntoChunks = (entry) => {
  const serialized = JSON.stringify(entry);
  if (serialized.length <= state.flow.maxEventChars || entry.event === 'event:chunk') {
    return null;
  }
  const chunkId = nextChunkId();
  const chunks = [];
  for (let offset = 0; offset < serialized.length; offset += state.flow.chunkChars) {
    chunks.push(serialized.slice(offset, offset + state.flow.chunkChars));
  }
  state.flow.chunked += 1;
  return chunks.map((chunk, index) => formatProgressEvent('event:chunk', {
    runId,
    ...(entry.jobId ? { jobId: entry.jobId } : {}),
    seq: nextSeq(entry.jobId || null),
    chunkId,
    chunkEvent: entry.event,
    chunkIndex: index,
    chunkCount: chunks.length,
    chunk
  }));
};

const emit = (event, payload = {}, { jobId = null, critical = false } = {}) => {
  const entry = formatProgressEvent(event, {
    runId,
    ...(jobId ? { jobId } : {}),
    seq: nextSeq(jobId),
    ...payload
  });
  const chunked = splitEventPayloadIntoChunks(entry);
  if (Array.isArray(chunked)) {
    for (const chunkEntry of chunked) {
      emitEntry(chunkEntry, { critical });
    }
    return;
  }
  emitEntry(entry, { critical: critical || CRITICAL_EVENTS.has(event) });
};

const emitLog = (jobId, level, message, extra = {}) => {
  emit('log', {
    level,
    message,
    ...extra
  }, { jobId });
};

const addFlowCredits = (value) => {
  const credits = clampInt(value, 0, { min: 0, max: FLOW_MAX_CREDITS });
  if (credits <= 0) return 0;
  state.flow.credits = Math.min(FLOW_MAX_CREDITS, state.flow.credits + credits);
  drainFlowQueue();
  return credits;
};

const emitRuntimeMetrics = () => {
  emit('runtime:metrics', {
    flow: {
      credits: state.flow.credits,
      queueDepth: state.flow.queue.length,
      sent: state.flow.sent,
      dropped: state.flow.dropped,
      coalesced: state.flow.coalesced,
      chunked: state.flow.chunked
    }
  }, { critical: true });
};

const resolveRunRequest = (request) => {
  if (typeof request?.command === 'string' && request.command.trim()) {
    const command = request.command.trim();
    const args = Array.isArray(request?.args) ? request.args.map((entry) => String(entry)) : [];
    const cwd = request?.cwd ? path.resolve(String(request.cwd)) : process.cwd();
    return { command, args, cwd };
  }
  const argv = Array.isArray(request?.argv)
    ? request.argv.map((entry) => String(entry))
    : [];
  if (!argv.length) {
    throw new Error('job:run requires non-empty argv array.');
  }
  const cwd = request?.cwd ? path.resolve(String(request.cwd)) : process.cwd();
  const command = process.execPath;
  const args = [path.join(ROOT, 'bin', 'pairofcleats.js'), ...argv];
  return { command, args, cwd };
};

const resolveResultPolicy = (request) => {
  const fallbackPolicy = request && typeof request === 'object' ? request : {};
  const policy = request?.resultPolicy && typeof request.resultPolicy === 'object'
    ? request.resultPolicy
    : fallbackPolicy;
  const rawCaptureStdout = policy.captureStdout;
  const captureStdout = ['none', 'text', 'json'].includes(rawCaptureStdout)
    ? rawCaptureStdout
    : (rawCaptureStdout === true ? 'text' : 'none');
  const maxBytes = clampInt(policy.maxBytes, 1_000_000, { min: 1024, max: 64 * 1024 * 1024 });
  return { captureStdout, maxBytes };
};

const cleanupFinalizedJob = (jobId) => {
  const job = getJob(jobId);
  if (!job || !job.finalized) return;
  state.jobs.delete(jobId);
};

const resolveRetryPolicy = (request) => {
  const retry = request?.retry && typeof request.retry === 'object' ? request.retry : {};
  return {
    maxAttempts: clampInt(retry.maxAttempts, 1, { min: 1, max: 5 }),
    delayMs: clampInt(retry.delayMs, 0, { min: 0, max: 60_000 })
  };
};

const resolveWatchdogConfigSource = (request) => {
  const rawWatchdog = request?.watchdog && typeof request.watchdog === 'object'
    ? request.watchdog
    : {};
  const runStageWatchdog = rawWatchdog?.stages?.run && typeof rawWatchdog.stages.run === 'object'
    ? rawWatchdog.stages.run
    : {};
  return { rawWatchdog, runStageWatchdog };
};

/**
 * Resolve run-stage watchdog policy from layered request fields.
 *
 * Order of precedence is stage-specific watchdog config, then top-level watchdog
 * config, then legacy `watchdogMs`. Derived values are clamped, and `softKickMs`
 * is guaranteed to be strictly below `hardTimeoutMs` when hard timeouts are enabled.
 *
 * @param {object} [request]
 * @returns {{
 *  hardTimeoutMs:number,
 *  heartbeatMs:number,
 *  softKickMs:number,
 *  softKickCooldownMs:number,
 *  softKickMaxAttempts:number
 * }}
 */
const resolveWatchdogPolicy = (request) => {
  const { rawWatchdog, runStageWatchdog } = resolveWatchdogConfigSource(request);
  const hardTimeoutMs = clampInt(
    runStageWatchdog.hardTimeoutMs
      ?? runStageWatchdog.timeoutMs
      ?? rawWatchdog.hardTimeoutMs
      ?? rawWatchdog.timeoutMs
      ?? request?.watchdogMs,
    0,
    { min: 0, max: WATCHDOG_MAX_MS }
  );
  const heartbeatMs = clampInt(
    runStageWatchdog.heartbeatMs
      ?? runStageWatchdog.progressHeartbeatMs
      ?? rawWatchdog.heartbeatMs
      ?? rawWatchdog.progressHeartbeatMs,
    hardTimeoutMs > 0
      ? Math.max(250, Math.min(5000, Math.floor(hardTimeoutMs / 4)))
      : 0,
    { min: 0, max: WATCHDOG_MAX_MS }
  );
  const configuredSoftKickMs = clampInt(
    runStageWatchdog.softKickMs
      ?? runStageWatchdog.stallSoftKickMs
      ?? rawWatchdog.softKickMs
      ?? rawWatchdog.stallSoftKickMs,
    -1,
    { min: 0, max: WATCHDOG_MAX_MS }
  );
  let softKickMs = configuredSoftKickMs >= 0
    ? configuredSoftKickMs
    : (hardTimeoutMs > 0 ? Math.max(250, Math.floor(hardTimeoutMs * 0.5)) : 0);
  if (hardTimeoutMs > 0 && softKickMs >= hardTimeoutMs) {
    softKickMs = Math.max(1, hardTimeoutMs - 1);
  }
  const softKickCooldownMs = clampInt(
    runStageWatchdog.softKickCooldownMs
      ?? rawWatchdog.softKickCooldownMs,
    WATCHDOG_SOFT_KICK_COOLDOWN_DEFAULT_MS,
    { min: 0, max: WATCHDOG_MAX_MS }
  );
  const softKickMaxAttempts = clampInt(
    runStageWatchdog.softKickMaxAttempts
      ?? rawWatchdog.softKickMaxAttempts,
    WATCHDOG_SOFT_KICK_MAX_ATTEMPTS_DEFAULT,
    { min: 0, max: 8 }
  );
  return {
    hardTimeoutMs,
    heartbeatMs,
    softKickMs,
    softKickCooldownMs,
    softKickMaxAttempts
  };
};

const buildSupervisorWatchdogSnapshot = ({
  job,
  idleMs = 0,
  source = 'watchdog',
  includeStack = true
} = {}) => ({
  source,
  capturedAt: nowIso(),
  idleMs: Math.max(0, Math.floor(Number(idleMs) || 0)),
  job: {
    id: job?.id || null,
    status: job?.status || null,
    pid: job?.pid || null,
    startedAt: Number.isFinite(Number(job?.startedAt))
      ? new Date(Number(job.startedAt)).toISOString()
      : null
  },
  flow: {
    credits: state.flow.credits,
    queueDepth: state.flow.queue.length,
    sent: state.flow.sent,
    dropped: state.flow.dropped,
    coalesced: state.flow.coalesced
  },
  trackedSubprocesses: snapshotTrackedSubprocesses({ limit: 6 }),
  process: captureProcessSnapshot({
    includeStack,
    frameLimit: includeStack ? 12 : 8,
    handleTypeLimit: 8
  })
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseResultFromStdout = (stdoutText, policy) => {
  if (policy.captureStdout === 'none') return null;
  const text = String(stdoutText || '').trim();
  if (!text) return null;
  if (policy.captureStdout === 'text') {
    return text;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const statArtifact = async ({ kind, label, artifactPath }) => {
  try {
    const stat = await fs.promises.stat(artifactPath);
    return {
      kind,
      label,
      path: artifactPath,
      exists: true,
      bytes: stat.size,
      mtime: stat.mtime.toISOString(),
      mime: null
    };
  } catch {
    return {
      kind,
      label,
      path: artifactPath,
      exists: false,
      bytes: null,
      mtime: null,
      mime: null
    };
  }
};

const resolveRepoArgFromTokens = (tokens) => {
  const list = Array.isArray(tokens) ? tokens.map((entry) => String(entry)) : [];
  for (let i = 0; i < list.length; i += 1) {
    const token = list[i];
    if (token === '--') break;
    if (token === '--repo') {
      const next = list[i + 1];
      if (typeof next === 'string' && next.trim()) return next.trim();
      continue;
    }
    if (token.startsWith('--repo=')) {
      const value = token.slice('--repo='.length).trim();
      if (value) return value;
    }
  }
  return null;
};

const resolveRequestRepoRoot = ({ request, cwd }) => {
  const baseCwd = request?.cwd
    ? path.resolve(String(request.cwd))
    : path.resolve(cwd || process.cwd());
  const argv = Array.isArray(request?.argv) ? request.argv : [];
  const args = Array.isArray(request?.args) ? request.args : [];
  const repoArg = resolveRepoArgFromTokens(argv) || resolveRepoArgFromTokens(args);
  if (repoArg) {
    return path.resolve(baseCwd, repoArg);
  }
  if (request?.repoRoot) {
    return path.resolve(String(request.repoRoot));
  }
  return baseCwd;
};

const collectJobArtifacts = async ({ request, cwd }) => {
  const artifacts = [];
  const argv = Array.isArray(request?.argv) ? request.argv.map((entry) => String(entry)) : [];
  const dispatch = resolveDispatchRequest(argv);
  const repoRoot = resolveRequestRepoRoot({ request, cwd });
  let userConfig = null;
  try {
    userConfig = loadUserConfig(repoRoot);
  } catch {
    userConfig = null;
  }

  if (dispatch?.id === 'index.build' || dispatch?.id === 'index.watch') {
    for (const mode of ['code', 'prose', 'extracted-prose', 'records']) {
      const indexDir = getIndexDir(repoRoot, mode, userConfig);
      artifacts.push(await statArtifact({
        kind: `index:${mode}`,
        label: `${mode} index`,
        artifactPath: indexDir
      }));
    }
  }

  if (dispatch?.id === 'search') {
    const metricsDir = getMetricsDir(repoRoot, userConfig);
    artifacts.push(await statArtifact({
      kind: 'metrics:search',
      label: 'search metrics dir',
      artifactPath: metricsDir
    }));
    artifacts.push(await statArtifact({
      kind: 'metrics:search-history',
      label: 'search history',
      artifactPath: path.join(metricsDir, 'searchHistory')
    }));
  }

  if (dispatch?.id === 'setup' || dispatch?.id === 'bootstrap') {
    artifacts.push(await statArtifact({
      kind: 'config:file',
      label: 'config file',
      artifactPath: path.join(repoRoot, '.pairofcleats.json')
    }));
    const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
    artifacts.push(await statArtifact({
      kind: 'cache:repo-root',
      label: 'repo cache root',
      artifactPath: repoCacheRoot
    }));
  }

  return artifacts
    .slice()
    .sort((a, b) => `${a.kind}|${a.path}`.localeCompare(`${b.kind}|${b.path}`));
};

const finalizeJob = (job, payload) => {
  if (job.finalized) return;
  job.finalized = true;
  job.status = payload.status;
  emit('job:end', payload, { jobId: job.id });
};

const emitArtifacts = async (job, request, { cwd } = {}) => {
  try {
    const artifacts = await collectJobArtifacts({ request, cwd });
    emit('job:artifacts', {
      artifacts,
      artifactsIndexed: true,
      source: 'supervisor'
    }, { jobId: job.id });
  } catch (error) {
    emit('job:artifacts', {
      artifacts: [],
      artifactsIndexed: false,
      source: 'supervisor',
      nonFatal: true,
      error: {
        message: error?.message || String(error),
        code: 'ARTIFACT_INDEX_FAILED'
      }
    }, { jobId: job.id });
  }
};

const startJob = async (request) => {
  const jobId = String(request?.jobId || '').trim();
  if (!jobId) {
    throw new Error('job:run requires jobId.');
  }
  if (state.jobs.has(jobId)) {
    throw new Error(`job already exists: ${jobId}`);
  }
  const title = String(request?.title || 'Job').trim() || 'Job';
  const retryPolicy = resolveRetryPolicy(request);
  const timeoutMs = clampInt(request?.timeoutMs, 0, { min: 0, max: 24 * 60 * 60 * 1000 });
  const deadlineMs = clampInt(request?.deadlineMs, 0, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const watchdogPolicy = resolveWatchdogPolicy(request);
  const job = {
    id: jobId,
    title,
    seq: 0,
    status: 'accepted',
    abortController: new AbortController(),
    cancelReason: null,
    pid: null,
    startedAt: Date.now(),
    finalized: false
  };
  state.jobs.set(jobId, job);

  emit('job:start', {
    command: Array.isArray(request?.argv) ? request.argv : [],
    cwd: request?.cwd ? path.resolve(String(request.cwd)) : process.cwd(),
    title,
    requested: {
      progressMode: request?.progressMode || 'jsonl',
      resultPolicy: resolveResultPolicy(request),
      retry: retryPolicy,
      watchdog: watchdogPolicy
    }
  }, { jobId });

  const runAttempt = async (attempt) => {
    const { command, args, cwd } = resolveRunRequest(request);
    const resultPolicy = resolveResultPolicy(request);
    const envPatch = request?.envPatch && typeof request.envPatch === 'object' ? request.envPatch : {};
    const env = applyProgressContextEnv({
      ...process.env,
      ...envPatch
    }, {
      runId,
      jobId
    });
    let lastActivityAt = Date.now();

    const timeoutFromDeadline = deadlineMs > 0
      ? Math.max(1, deadlineMs - Date.now())
      : 0;
    const effectiveTimeoutMs = timeoutMs > 0 && timeoutFromDeadline > 0
      ? Math.min(timeoutMs, timeoutFromDeadline)
      : (timeoutMs > 0 ? timeoutMs : timeoutFromDeadline || undefined);

    const stdoutDecoder = createProgressLineDecoder({
      strict: true,
      maxLineBytes: resultPolicy.maxBytes,
      onLine: ({ line, event }) => {
        lastActivityAt = Date.now();
        if (event) {
          const { proto, event: eventName, ts, seq, runId: ignoredRunId, jobId: ignoredJobId, ...rest } = event;
          emit(eventName, {
            ...rest,
            ...(typeof rest.stream === 'string' ? {} : { stream: 'stdout' })
          }, { jobId });
          return;
        }
        if (line.trim()) {
          emitLog(jobId, 'info', line, { stream: 'stdout', pid: job.pid || null });
        }
      },
      onOverflow: ({ overflowBytes }) => {
        lastActivityAt = Date.now();
        emitLog(jobId, 'warn', `stdout decoder overflow (${overflowBytes} bytes truncated).`, { stream: 'stdout' });
      }
    });

    const stderrDecoder = createProgressLineDecoder({
      strict: true,
      maxLineBytes: resultPolicy.maxBytes,
      onLine: ({ line, event }) => {
        lastActivityAt = Date.now();
        if (event) {
          const { proto, event: eventName, ts, seq, runId: ignoredRunId, jobId: ignoredJobId, ...rest } = event;
          emit(eventName, {
            ...rest,
            ...(typeof rest.stream === 'string' ? {} : { stream: 'stderr' })
          }, { jobId });
          return;
        }
        if (line.trim()) {
          emitLog(jobId, 'info', line, { stream: 'stderr', pid: job.pid || null });
        }
      },
      onOverflow: ({ overflowBytes }) => {
        lastActivityAt = Date.now();
        emitLog(jobId, 'warn', `stderr decoder overflow (${overflowBytes} bytes truncated).`, { stream: 'stderr' });
      }
    });

    const startedAt = Date.now();
    let watchdogTimer = null;
    let watchdogLastHeartbeatAt = 0;
    let watchdogSoftKickAttempts = 0;
    let watchdogSoftKickInFlight = false;
    let watchdogLastSoftKickAt = 0;
    const stopWatchdog = () => {
      if (watchdogTimer) {
        clearInterval(watchdogTimer);
        watchdogTimer = null;
      }
    };
    const emitWatchdogHeartbeat = (idleMs) => {
      if (watchdogPolicy.heartbeatMs <= 0) return;
      const nowMs = Date.now();
      if (watchdogLastHeartbeatAt > 0 && (nowMs - watchdogLastHeartbeatAt) < watchdogPolicy.heartbeatMs) return;
      watchdogLastHeartbeatAt = nowMs;
      const snapshot = buildSupervisorWatchdogSnapshot({
        job,
        idleMs,
        source: 'watchdog_heartbeat',
        includeStack: false
      });
      emitLog(
        jobId,
        'info',
        `watchdog heartbeat idle=${Math.floor(idleMs)}ms pid=${job.pid || 'n/a'}`,
        {
          watchdogPhase: 'heartbeat',
          idleMs: Math.floor(idleMs),
          watchdogSnapshot: snapshot
        }
      );
    };
    const runSoftKick = (idleMs) => {
      if (watchdogSoftKickInFlight || job.finalized || job.abortController.signal.aborted) return;
      watchdogSoftKickInFlight = true;
      watchdogSoftKickAttempts += 1;
      watchdogLastSoftKickAt = Date.now();
      const snapshot = buildSupervisorWatchdogSnapshot({
        job,
        idleMs,
        source: 'watchdog_soft_kick',
        includeStack: true
      });
      emitLog(
        jobId,
        'warn',
        `watchdog soft-kick attempt ${watchdogSoftKickAttempts}/${watchdogPolicy.softKickMaxAttempts} `
          + `(idle=${Math.floor(idleMs)}ms)`,
        {
          watchdogPhase: 'soft-kick',
          softKickAttempt: watchdogSoftKickAttempts,
          softKickMaxAttempts: watchdogPolicy.softKickMaxAttempts,
          idleMs: Math.floor(idleMs),
          watchdogSnapshot: snapshot
        }
      );
      emit('job:watchdog', {
        phase: 'soft-kick',
        idleMs: Math.floor(idleMs),
        attempt: watchdogSoftKickAttempts,
        maxAttempts: watchdogPolicy.softKickMaxAttempts,
        snapshot
      }, { jobId, critical: true });
      try {
        if (Number.isFinite(Number(job.pid)) && Number(job.pid) > 0 && process.platform !== 'win32') {
          process.kill(Number(job.pid), 'SIGCONT');
        }
      } catch {}
      watchdogSoftKickInFlight = false;
    };
    if (watchdogPolicy.hardTimeoutMs > 0 || watchdogPolicy.softKickMs > 0 || watchdogPolicy.heartbeatMs > 0) {
      const pollMs = Math.max(
        250,
        Math.min(
          1000,
          Math.floor(Math.max(watchdogPolicy.hardTimeoutMs || watchdogPolicy.heartbeatMs || 1000, 1000) / 4)
        )
      );
      watchdogTimer = setInterval(() => {
        if (job.finalized || job.abortController.signal.aborted) return;
        const nowMs = Date.now();
        const idleMs = Math.max(0, nowMs - lastActivityAt);
        if (watchdogPolicy.heartbeatMs > 0 && idleMs >= watchdogPolicy.heartbeatMs) {
          emitWatchdogHeartbeat(idleMs);
        }
        if (
          watchdogPolicy.softKickMs > 0
          && idleMs >= watchdogPolicy.softKickMs
          && watchdogSoftKickAttempts < watchdogPolicy.softKickMaxAttempts
          && (watchdogPolicy.softKickCooldownMs <= 0 || nowMs - watchdogLastSoftKickAt >= watchdogPolicy.softKickCooldownMs)
        ) {
          runSoftKick(idleMs);
        }
        if (watchdogPolicy.hardTimeoutMs <= 0 || idleMs < watchdogPolicy.hardTimeoutMs) return;
        const snapshot = buildSupervisorWatchdogSnapshot({
          job,
          idleMs,
          source: 'watchdog_hard_timeout',
          includeStack: true
        });
        job.cancelReason = 'watchdog_timeout';
        emitLog(
          jobId,
          'warn',
          `watchdog timeout (${watchdogPolicy.hardTimeoutMs}ms inactivity)`,
          {
            watchdogPhase: 'hard-timeout',
            idleMs: Math.floor(idleMs),
            watchdogSnapshot: snapshot
          }
        );
        emit('job:watchdog', {
          phase: 'hard-timeout',
          idleMs: Math.floor(idleMs),
          hardTimeoutMs: watchdogPolicy.hardTimeoutMs,
          softKickAttempts: watchdogSoftKickAttempts,
          snapshot
        }, { jobId, critical: true });
        job.abortController.abort('watchdog_timeout');
      }, pollMs);
      if (typeof watchdogTimer.unref === 'function') watchdogTimer.unref();
    }

    try {
      const result = await spawnSubprocess(command, args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        rejectOnNonZeroExit: false,
        signal: job.abortController.signal,
        timeoutMs: effectiveTimeoutMs,
        onSpawn: (child) => {
          job.pid = child?.pid || null;
          job.status = 'running';
          lastActivityAt = Date.now();
          emit('job:spawn', {
            pid: job.pid,
            spawnedAt: nowIso()
          }, { jobId });
        },
        onStdout: (chunk) => stdoutDecoder.push(chunk),
        onStderr: (chunk) => stderrDecoder.push(chunk)
      });

      stdoutDecoder.flush();
      stderrDecoder.flush();

      const cancelled = job.abortController.signal.aborted;
      const status = cancelled
        ? 'cancelled'
        : (result.exitCode === 0 ? 'done' : 'failed');
      const payload = {
        status,
        exitCode: cancelled ? 130 : (result.exitCode ?? null),
        signal: result.signal || null,
        durationMs: Math.max(0, Date.now() - startedAt),
        result: parseResultFromStdout(result.stdout, resultPolicy),
        error: status === 'failed'
          ? {
            message: `job failed with exit code ${result.exitCode ?? 'unknown'}`,
            code: 'JOB_FAILED'
          }
          : null
      };

      if (status === 'failed' && attempt < retryPolicy.maxAttempts) {
        emitLog(jobId, 'warn', `attempt ${attempt} failed; retrying (${attempt + 1}/${retryPolicy.maxAttempts})`, {
          attempt,
          maxAttempts: retryPolicy.maxAttempts
        });
        if (retryPolicy.delayMs > 0) {
          await sleep(retryPolicy.delayMs);
        }
        return runAttempt(attempt + 1);
      }

      finalizeJob(job, payload);
      await emitArtifacts(job, request, { cwd });
    } catch (error) {
      const cancelled = job.abortController.signal.aborted || error?.name === 'AbortError';
      const cancelReason = job.cancelReason || String(job.abortController.signal.reason || '');
      const payload = {
        status: cancelled ? 'cancelled' : 'failed',
        exitCode: cancelled ? 130 : null,
        signal: null,
        durationMs: Math.max(0, Date.now() - startedAt),
        result: null,
        error: {
          message: error?.message || String(error),
          code: cancelled ? (cancelReason || 'CANCELLED') : 'SPAWN_FAILED'
        }
      };
      if (!cancelled && attempt < retryPolicy.maxAttempts) {
        emitLog(jobId, 'warn', `attempt ${attempt} failed; retrying (${attempt + 1}/${retryPolicy.maxAttempts})`, {
          attempt,
          maxAttempts: retryPolicy.maxAttempts,
          error: payload.error.message
        });
        if (retryPolicy.delayMs > 0) {
          await sleep(retryPolicy.delayMs);
        }
        return runAttempt(attempt + 1);
      }
      finalizeJob(job, payload);
      await emitArtifacts(job, request, { cwd });
    } finally {
      stopWatchdog();
    }
  };

  runAttempt(1).catch(async (error) => {
    if (job.finalized) return;
    finalizeJob(job, {
      status: 'failed',
      exitCode: null,
      signal: null,
      durationMs: Math.max(0, Date.now() - job.startedAt),
      result: null,
      error: {
        message: error?.message || String(error),
        code: 'INVALID_REQUEST'
      }
    });
    await emitArtifacts(job, request, {
      cwd: request?.cwd ? path.resolve(String(request.cwd)) : process.cwd()
    });
  }).finally(() => {
    job.status = job.status === 'cancelled' ? 'cancelled' : (job.status || 'done');
    cleanupFinalizedJob(jobId);
  });
};

const cancelJob = (jobId, reason = 'cancel_requested') => {
  const job = getJob(jobId);
  if (!job) return false;
  if (job.finalized) {
    cleanupFinalizedJob(jobId);
    return true;
  }
  job.status = 'cancelling';
  job.cancelReason = reason;
  emitLog(jobId, 'info', `cancelling job (${reason})`, { reason });
  job.abortController.abort(reason);
  return true;
};

const shutdown = async (reason = 'shutdown', exitCode = 0) => {
  if (state.shuttingDown) return;
  state.shuttingDown = true;
  if (runtimeMetricsTimer) {
    clearInterval(runtimeMetricsTimer);
  }
  state.shutdownStartedAt = Date.now();
  emitLog(null, 'info', 'supervisor shutdown requested', { reason });
  for (const job of state.jobs.values()) {
    cancelJob(job.id, reason);
  }
  const timeoutMs = 10_000;
  while (Date.now() - state.shutdownStartedAt < timeoutMs) {
    const active = Array.from(state.jobs.values()).some((job) => !job.finalized);
    if (!active) break;
    await sleep(50);
  }
  eventLogRecorder?.finalize(reason);
  process.exit(exitCode);
};

const handleRequest = async (request) => {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    emitLog(null, 'error', 'invalid request shape');
    return;
  }
  if (request.proto !== SUPERVISOR_PROTOCOL) {
    emitLog(null, 'error', 'invalid supervisor proto', { expected: SUPERVISOR_PROTOCOL });
    return;
  }
  const op = String(request.op || '').trim();
  if (!op) {
    emitLog(null, 'error', 'request missing op');
    return;
  }
  if (op === 'hello') {
    emit('hello', {
      supervisorVersion,
      capabilities: {
        protocolVersion: PROGRESS_PROTOCOL,
        supportsCancel: true,
        supportsResultCapture: true,
        supportsFlowControl: true,
        supportsChunking: true
      }
    }, { critical: true });
    emitRuntimeMetrics();
    return;
  }
  if (op === 'flow:credit') {
    const added = addFlowCredits(request.credits);
    emitRuntimeMetrics();
    if (added <= 0) {
      emitLog(null, 'warn', 'ignored invalid flow:credit request', { credits: request.credits });
    }
    return;
  }
  if (op === 'job:run') {
    try {
      await startJob(request);
    } catch (error) {
      const jobId = typeof request.jobId === 'string' ? request.jobId : null;
      emitLog(jobId, 'error', error?.message || String(error));
      if (jobId && state.jobs.has(jobId)) {
        const job = state.jobs.get(jobId);
        finalizeJob(job, {
          status: 'failed',
          exitCode: null,
          signal: null,
          durationMs: 0,
          result: null,
          error: {
            message: error?.message || String(error),
            code: 'INVALID_REQUEST'
          }
        });
        cleanupFinalizedJob(jobId);
      }
    }
    return;
  }
  if (op === 'job:cancel') {
    const jobId = String(request.jobId || '').trim();
    if (!jobId) {
      emitLog(null, 'error', 'job:cancel missing jobId');
      return;
    }
    cancelJob(jobId, request.reason || 'cancel_requested');
    return;
  }
  if (op === 'shutdown') {
    await shutdown(request.reason || 'shutdown', 0);
    return;
  }
  emitLog(null, 'error', `unknown op: ${op}`);
};

let stdinCarry = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  const text = `${stdinCarry}${String(chunk || '')}`.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const parts = text.split('\n');
  stdinCarry = parts.pop() || '';
  for (const line of parts) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let request;
    try {
      request = JSON.parse(trimmed);
    } catch {
      emitLog(null, 'error', 'invalid JSON request line');
      continue;
    }
    handleRequest(request).catch((error) => {
      emitLog(null, 'error', error?.message || String(error));
    });
  }
});

process.stdin.on('end', () => {
  shutdown('stdin_closed', 0).catch(() => process.exit(0));
});

process.on('SIGINT', () => {
  shutdown('sigint', 130).catch(() => process.exit(130));
});

process.on('SIGTERM', () => {
  shutdown('sigterm', 130).catch(() => process.exit(130));
});

emit('hello', {
  supervisorVersion,
  capabilities: {
    protocolVersion: PROGRESS_PROTOCOL,
    supportsCancel: true,
    supportsResultCapture: true,
    supportsFlowControl: true,
    supportsChunking: true
  }
}, { critical: true });

const runtimeMetricsTimer = setInterval(() => {
  if (state.shuttingDown) return;
  emitRuntimeMetrics();
}, FLOW_METRICS_INTERVAL_MS);
if (typeof runtimeMetricsTimer.unref === 'function') {
  runtimeMetricsTimer.unref();
}
