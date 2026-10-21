#!/usr/bin/env node
import { getTuiEnvConfig, getTuiWorkspaceRoot } from '../../src/shared/env/tui.js';
import { getToolVersion, resolveToolRoot } from '../shared/dict-utils.js';
import { FLOW_METRICS_INTERVAL_MS, SUPERVISOR_PROTOCOL } from './supervisor/constants.js';
import { createJobController } from './supervisor/jobs.js';
import { createEventLogRecorder, createFlowController } from './supervisor/protocol-flow.js';
import { normalizeLineBreaks, sleep } from './supervisor/request-utils.js';
import { createCli } from '../../src/shared/cli.js';
import { assertTuiControlReason } from '../../src/contracts/validators/tui-request.js';

createCli({
  scriptName: 'pairofcleats tui supervisor',
  usage: 'Run the TUI supervisor over stdin/stdout using the poc.tui@1 protocol.'
}).strictOptions().parse();

const ROOT = resolveToolRoot();
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

const state = {
  shuttingDown: false,
  shutdownStartedAt: 0,
  globalSeq: 0,
  jobs: new Map()
};

/** @param {string|null} jobId @returns {object|null} */
const getJob = (jobId) => (typeof jobId === 'string' ? state.jobs.get(jobId) : null);

/**
 * Allocate next event sequence id globally or for a specific job.
 *
 * @param {string|null} [jobId]
 * @returns {number}
 */
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

const eventLogRecorder = createEventLogRecorder({
  requestedDir: tuiEnvConfig.eventLogDir,
  runId,
  supervisorVersion,
  root: ROOT
});

const {
  emit,
  emitLog,
  emitHello,
  emitRuntimeMetrics,
  addFlowCredits,
  buildFlowSnapshot
} = createFlowController({
  runId,
  nextSeq,
  eventLogRecorder
});

const buildSessionDescriptor = () => ({
  mode: 'supervised',
  source: 'local-supervisor',
  scope: getTuiWorkspaceRoot() || process.cwd(),
  connection: 'connected',
  note: 'interactive supervisor session',
  controllable: true
});

const {
  startJob,
  startOperation,
  cancelJob,
  failJobInvalidRequest
} = createJobController({
  state,
  runId,
  root: ROOT,
  emit,
  emitLog,
  buildFlowSnapshot
});

let runtimeMetricsTimer = null;
let settingsSession = null;
let settingsModules = null;
const runSettings = async (request, { signal }) => {
  settingsModules ||= Promise.all([import('./operator/settings.js'),
    import('../../src/contracts/validators/tui-settings.js')]);
  const [settings, contracts] = await settingsModules;
  contracts.assertTuiSettingsRequest('dispatch', request);
  contracts.assertTuiSettingsRequest(request.method, request.params);
  if (signal.aborted) throw Object.assign(new Error('Cancelled.'), { code: 'ABORT_ERR' });
  settingsSession ||= settings.createTuiSettingsSession({ toolRoot: ROOT });
  const methods = { select: 'selectScope', inspect: 'inspectConfig', preview: 'preview', commit: 'commit', cancel: 'cancel' };
  return settingsSession[methods[request.method]](request.params, { signal });
};

let searchSession = null;
let searchModules = null;
const runSearch = async (request, context) => {
  const { signal } = context;
  searchModules ||= Promise.all([import('./operator/search.js'),
    import('../../src/contracts/validators/tui-search.js')]);
  const [search, contracts] = await searchModules;
  contracts.assertTuiSearchRequest('dispatch', request);
  contracts.assertTuiSearchRequest(request.method, request.params);
  if (signal.aborted) throw Object.assign(new Error('Cancelled.'), { code: 'ABORT_ERR' });
  searchSession ||= search.createTuiSearchSession({ toolRoot: ROOT });
  const methods = { describe: 'describe', query: 'query', continue: 'continueSearch', source: 'source', open: 'open' };
  return searchSession[methods[request.method]](request.params, context);
};

/**
 * Gracefully cancel all jobs and terminate supervisor process.
 *
 * @param {string} [reason='shutdown']
 * @param {number} [exitCode=0]
 * @returns {Promise<void>}
 */
const shutdown = async (reason = 'shutdown', exitCode = 0) => {
  assertTuiControlReason(reason);
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
  settingsSession?.dispose();
  await searchSession?.dispose();
  eventLogRecorder?.finalize(reason);
  process.exit(exitCode);
};

/**
 * Route one parsed supervisor request message.
 *
 * @param {object} request
 * @returns {Promise<void>}
 */
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
    emitHello({ supervisorVersion, session: buildSessionDescriptor() });
    emitRuntimeMetrics();
    return;
  }
  if (op === 'flow:credit') {
    const added = addFlowCredits(request.credits);
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
      if (jobId && state.jobs.has(jobId)
        && !['ERR_TUI_JOB_EXISTS', 'ERR_TUI_SHUTTING_DOWN'].includes(error?.code)) {
        failJobInvalidRequest(jobId, error);
      }
    }
    return;
  }
  if (op === 'settings:run') {
    try {
      await startOperation({ jobId: request.jobId, method: request.method }, context => runSettings(request, context),
        { isCommitted: data => data?.saved === true || (request.method === 'select' && typeof data?.id === 'string') });
    } catch {
      // Never persist unvalidated input or raw parser/subprocess error messages.
      emitLog(null, 'error', 'Settings request was not admitted.');
    }
    return;
  }
  if (op === 'search:run') {
    try {
      await startOperation({ jobId: request.jobId, method: request.method }, context => runSearch(request, context),
        { title: 'Search', isCommitted: data => data?.opened === true });
    } catch {
      emitLog(null, 'error', 'Search request was not admitted.');
    }
    return;
  }
  if (op === 'job:cancel') {
    const jobId = String(request.jobId || '').trim();
    if (!jobId) {
      emitLog(null, 'error', 'job:cancel missing jobId');
      return;
    }
    try { cancelJob(jobId, request.reason === undefined ? 'cancel_requested' : request.reason); }
    catch (error) {
      if (error.code !== 'ERR_TUI_CANCEL_REASON') throw error;
      emitLog(jobId, 'error', 'Cancellation request was not admitted.', { code: error.code });
    }
    return;
  }
  if (op === 'shutdown') {
    try { await shutdown(request.reason === undefined ? 'shutdown' : request.reason, 0); }
    catch (error) {
      if (error.code !== 'ERR_TUI_CANCEL_REASON') throw error;
      emitLog(null, 'error', 'Shutdown request was not admitted.', { code: error.code });
    }
    return;
  }
  emitLog(null, 'error', `unknown op: ${op}`);
};

let stdinCarry = '';
/**
 * Parse one newline-delimited request frame.
 *
 * @param {string} line
 * @returns {void}
 */
const handleRequestLine = (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let request;
  try {
    request = JSON.parse(trimmed);
  } catch {
    emitLog(null, 'error', 'invalid JSON request line');
    return;
  }
  handleRequest(request).catch((error) => {
    emitLog(null, 'error', error?.message || String(error));
  });
};

/**
 * Consume a raw stdin chunk and dispatch complete JSONL request lines.
 *
 * @param {string|Buffer} chunk
 * @returns {void}
 */
const consumeStdinChunk = (chunk) => {
  const text = normalizeLineBreaks(`${stdinCarry}${String(chunk || '')}`);
  const parts = text.split('\n');
  stdinCarry = parts.pop() || '';
  for (const line of parts) {
    handleRequestLine(line);
  }
};

process.stdin.setEncoding('utf8');
process.stdin.on('data', consumeStdinChunk);

process.stdin.on('end', () => {
  shutdown('stdin_closed', 0).catch(() => process.exit(0));
});

process.on('SIGINT', () => {
  shutdown('sigint', 130).catch(() => process.exit(130));
});

process.on('SIGTERM', () => {
  shutdown('sigterm', 130).catch(() => process.exit(130));
});

emitHello({ supervisorVersion, session: buildSessionDescriptor() });

runtimeMetricsTimer = setInterval(() => {
  if (state.shuttingDown) return;
  emitRuntimeMetrics();
}, FLOW_METRICS_INTERVAL_MS);
if (typeof runtimeMetricsTimer.unref === 'function') {
  runtimeMetricsTimer.unref();
}
