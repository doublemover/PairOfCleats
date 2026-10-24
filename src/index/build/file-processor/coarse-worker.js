import { processFileCpu } from './cpu.js';
import { currentSchedulerTaskLease } from '../../../shared/concurrency/scheduler-task-scope.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { decodeFileAnalysisResult, projectFileAnalysisInput, fileAnalysisAdmissionBytes, isFileAnalysisCandidate,
  FILE_ANALYSIS_MAX_EVENTS, FILE_ANALYSIS_TIMING_METHODS, fileAnalysisProtocolError } from '../workers/file-analysis-contract.js';

const EVENT_KINDS = new Set([...FILE_ANALYSIS_TIMING_METHODS, 'log', 'logLine', 'crash', 'crashError', 'perf']);
const mergeCounters = (target, source) => {
  for (const [key, value] of Object.entries(source || {})) {
    if (typeof value === 'number') target[key] = /HighWater|Peak|Max/u.test(key)
      ? Math.max(Number(target[key]) || 0, value) : key === 'retainedChunks' ? value : (Number(target[key]) || 0) + value;
    else if (value && typeof value === 'object' && !Array.isArray(value)) mergeCounters(target[key] ||= {}, value);
    else if (target[key] == null) target[key] = value;
  }
};
const validateCompleted = data => {
  if (data?.status === 'unsupported' && typeof data.reason === 'string' && data.reason.length <= 128) return;
  if (data?.status !== 'completed' || !Array.isArray(data.events) || data.events.length > FILE_ANALYSIS_MAX_EVENTS
    || data.events.some(event => !EVENT_KINDS.has(event?.kind) || !Array.isArray(event.args) || event.args.length > 8)
    || (data.result != null && (!Array.isArray(data.result.chunks) || typeof data.result !== 'object'))
    || !data.tokenizationStats || typeof data.tokenizationStats !== 'object') throw fileAnalysisProtocolError('result-projection');
};
const replayObservers = (context, data) => {
  for (const event of data.events) {
    if (FILE_ANALYSIS_TIMING_METHODS.includes(event.kind)) context.timing?.[event.kind]?.(...event.args);
    else if (event.kind === 'log' || event.kind === 'logLine') context[event.kind]?.(...event.args);
    else if (event.kind === 'perf') context.perfEventLogger?.emit?.(...event.args);
    else if (event.kind === 'crash') context.crashLogger?.updateFile?.(...event.args);
    else if (event.kind === 'crashError') context.crashLogger?.logError?.(...event.args);
  }
  if (context.tokenizationStats) mergeCounters(context.tokenizationStats, data.tokenizationStats);
};
const observeStage = (context, stage) => { try { context.onStage?.(stage); } catch {} };

/** The parent retains its original compute/file/byte reservation while the
 * worker computes. Unsupported projections run the exact existing caller path;
 * uncertain backend lifetime, cancellation and pressure errors never retry here. */
export const processFileCpuWithWorker = async context => {
  const evidence = context.tokenizationStats ? (context.tokenizationStats.coarseAnalysis ||= {
    attempted: 0, completed: 0, inputBytes: 0, outputBytes: 0, declined: {}
  }) : null;
  const inline = reason => {
    if (evidence) evidence.declined[reason] = (evidence.declined[reason] || 0) + 1;
    return processFileCpu(context);
  };
  if (!isFileAnalysisCandidate(context)) return inline('not-opted-in');
  if (!context.workerPool.shouldUseForFile?.(context.fileStat?.size || 0)) return inline('worker-routing');
  const lease = currentSchedulerTaskLease();
  if (!lease?.active || !(lease.used.cpu > 0)
    || lease.used.bytes < fileAnalysisAdmissionBytes(Buffer.byteLength(context.text || ''))) return inline('retained-admission');
  throwIfAborted(context.signal);
  const prepared = projectFileAnalysisInput(context);
  if (!prepared.payload) return inline(prepared.reason);
  if (evidence) { evidence.attempted++; evidence.inputBytes += prepared.payload.body.byteLength; }
  observeStage(context, 'coarse-worker:await');
  // Worker transport owns abort/termination and heap acknowledgment. Only a
  // pre-dispatch unavailable result or a received, completed protocol refusal
  // can authorize the existing inline fallback below.
  const envelope = await context.workerPool.analyzeFile(prepared.payload, { signal: context.signal });
  throwIfAborted(context.signal);
  if (envelope == null) return inline('backend-not-started');
  let data;
  try { data = decodeFileAnalysisResult(prepared.payload, envelope); validateCompleted(data); }
  catch (error) {
    if (error?.code !== 'ERR_FILE_ANALYSIS_PROTOCOL' && error?.code !== 'ERR_FILE_ANALYSIS_BUDGET') throw error;
    return inline('rejected-result');
  }
  if (data.status === 'unsupported') return inline(`projection-refused:${data.reason}`);
  if (evidence) { evidence.completed++; evidence.outputBytes += envelope.outputBytes; }
  // Keep observer failures outside fallback authority: an accepted result must
  // never cause a second analysis merely because presentation failed afterward.
  replayObservers(context, data);
  observeStage(context, 'coarse-worker:done');
  return data.result;
};
