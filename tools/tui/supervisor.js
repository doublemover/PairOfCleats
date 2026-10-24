#!/usr/bin/env node
import { getTuiEnvConfig, getTuiWorkspaceRoot } from '../../src/shared/env/tui.js';
import { getToolVersion, resolveToolRoot } from '../shared/dict-utils.js';
import { FLOW_METRICS_INTERVAL_MS, SUPERVISOR_PROTOCOL } from './supervisor/constants.js';
import { createJobController } from './supervisor/jobs.js';
import { createEventLogRecorder, createFlowController } from './supervisor/protocol-flow.js';
import { normalizeLineBreaks } from './supervisor/request-utils.js';
import { createCli } from '../../src/shared/cli.js';
import { assertTuiControlReason } from '../../src/contracts/validators/tui-request.js';
import { createTuiArtifactRegistry } from './operator/artifact-registry.js';
import { drainTuiBackendReaders, disposeTuiSessionSlot } from './operator/backend-reader-drain.js';
import { createSupervisorOutput } from './supervisor/output.js';
import { createSupervisorShutdown } from './supervisor/shutdown.js';

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

const output = createSupervisorOutput({ onFailure: () => { void shutdown('stdout_failed', 1); } });

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
  eventLogRecorder,
  output
});

const buildSessionDescriptor = () => ({
  mode: 'supervised',
  source: 'local-supervisor',
  scope: getTuiWorkspaceRoot() || process.cwd(),
  connection: 'connected',
  note: 'interactive supervisor session',
  controllable: true
});

let artifactRegistry = createTuiArtifactRegistry();

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
  buildFlowSnapshot,
  beginArtifactJob: id => /^[a-zA-Z0-9_-]{1,128}$/.test(id) ? artifactRegistry.beginJob(id) : null,
  captureArtifactInventory: input => artifactRegistry.capture(input),
  assertWorkAdmission: ({ kind, method }) => {
    output.assertWritable();
    if (kind === 'operation' && ['status', 'describe', 'services', 'stop-service'].includes(method)) return;
    indexWorkflows?.assertCacheAdmission();
  }
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

let artifactActions = null, artifactModules = null;
const runArtifact = async (request, context) => {
  artifactModules ||= Promise.all([import('./operator/artifacts.js'),
    import('../../src/contracts/validators/tui-artifact.js')]);
  const [actions, contracts] = await artifactModules;
  contracts.assertTuiArtifactRequest('dispatch', request);
  contracts.assertTuiArtifactRequest(request.method, request.params);
  if (context.signal.aborted) throw Object.assign(new Error('Cancelled.'), { code: 'ABORT_ERR' });
  artifactActions ||= actions.createTuiArtifactActions({ registry: artifactRegistry, toolRoot: ROOT });
  return artifactActions.execute(request.method, request.params, context);
};

let indexWorkflows = null, workflowModules = null;
const drainBackendReaders = input => drainTuiBackendReaders({ ...input, jobs: state.jobs,
  closeSearch: () => disposeTuiSessionSlot({ current: () => searchSession, replace: value => { searchSession = value; } }),
  closeArtifactActions: () => disposeTuiSessionSlot({ current: () => artifactActions, replace: value => { artifactActions = value; } }),
  resetArtifactRegistry: async () => {
    await artifactRegistry.dispose();
    artifactRegistry = createTuiArtifactRegistry();
    return artifactRegistry;
  } });
let recordings = null, recordingModules = null;
const runRecording = async (request, context) => {
  recordingModules ||= Promise.all([import('./operator/recordings.js'),
    import('../../src/contracts/validators/tui-recording.js')]);
  const [owner, contracts] = await recordingModules;
  contracts.assertTuiRecordingRequest('dispatch', request);
  contracts.assertTuiRecordingRequest(request.method, request.params);
  if (context.signal.aborted) throw Object.assign(new Error('Cancelled.'), { code: 'ABORT_ERR' });
  recordings ||= owner.createTuiRecordings();
  return recordings[request.method](request.params, context);
};
const runWorkflow = async (request, context) => {
  workflowModules ||= Promise.all([import('./operator/index-workflows.js'),
    import('./operator/settings.js'), import('../../src/contracts/validators/tui-workflow.js')]);
  const [workflows, settings, contracts] = await workflowModules;
  contracts.assertTuiWorkflowRequest('dispatch', request);
  contracts.assertTuiWorkflowRequest(request.method, request.params);
  if (context.signal.aborted) throw Object.assign(new Error('Cancelled.'), { code: 'ABORT_ERR' });
  settingsSession ||= settings.createTuiSettingsSession({ toolRoot: ROOT });
  if (request.method === 'select') {
    await indexWorkflows?.reset();
    return settingsSession.selectScope(request.params, context);
  }
  indexWorkflows ||= workflows.createTuiIndexWorkflows({ scopes: settingsSession, startJob, toolRoot: ROOT,
    getJob, cancelJob,
    drainLocalReaders: drainBackendReaders,
    // Enabled only together with actual canonical SQLite/LMDB closure hooks.
    backendDelegationEnabled: true });
  return indexWorkflows[request.method](request.params, context);
};

/**
 * Gracefully cancel all jobs and terminate supervisor process.
 *
 * @param {string} [reason='shutdown']
 * @param {number} [exitCode=0]
 * @returns {Promise<void>}
 */
const shutdown = createSupervisorShutdown({ state, cancelJob, output, recorder: eventLogRecorder, emitLog,
  stopMetrics: () => { if (runtimeMetricsTimer) clearInterval(runtimeMetricsTimer); },
  closeOwners: () => ({ settings: () => settingsSession?.dispose(), workflows: () => indexWorkflows?.dispose(),
    recordings: () => recordings?.dispose(), search: () => searchSession?.dispose(),
    artifacts: () => artifactRegistry.dispose(), artifactActions: () => artifactActions?.dispose() }) });

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
  if (op === 'artifact:run') {
    try {
      await startOperation({ jobId: request.jobId, method: request.method }, context => runArtifact(request, context),
        { title: 'Artifact', isCommitted: data => data?.opened === true || data?.copied === true || data?.exported === true });
    } catch {
      emitLog(null, 'error', 'Artifact request was not admitted.');
    }
    return;
  }
  if (op === 'workflow:run') {
    try {
      await startOperation({ jobId: request.jobId, method: request.method }, context => runWorkflow(request, context),
        { title: 'Index workflow', isCommitted: data => data?.launched === true || typeof data?.id === 'string'
          || data?.nativePageCommitted === true || data?.discarded === true || data?.stopRequested === true });
    } catch {
      emitLog(null, 'error', 'Workflow request was not admitted.');
    }
    return;
  }
  if (op === 'recording:run') {
    try {
      await startOperation({ jobId: request.jobId, method: request.method }, context => runRecording(request, context),
        { title: 'Saved session', isCommitted: () => false });
    } catch {
      emitLog(null, 'error', 'Recording request was not admitted.');
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
  void shutdown('stdin_closed', 0);
});
process.stdin.on('error', () => { void shutdown('stdin_failed', 1); });

process.on('SIGINT', () => {
  void shutdown('sigint', 130);
});

process.on('SIGTERM', () => {
  void shutdown('sigterm', 130);
});

emitHello({ supervisorVersion, session: buildSessionDescriptor() });

runtimeMetricsTimer = setInterval(() => {
  if (state.shuttingDown) return;
  emitRuntimeMetrics();
}, FLOW_METRICS_INTERVAL_MS);
if (typeof runtimeMetricsTimer.unref === 'function') {
  runtimeMetricsTimer.unref();
}
