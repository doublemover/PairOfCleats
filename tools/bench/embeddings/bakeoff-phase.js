import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { SubprocessError } from '../../../src/shared/subprocess/errors.js';
import { composeAbortSignals, throwIfAborted } from '../../../src/shared/abort.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { redactDiagnosticText } from '../../../src/shared/diagnostic-text.js';
import { formatElapsed } from './model-bakeoff-lib.js';

export const BAKEOFF_PHASE_STATE_VERSION = 1;
const data = (value, key) => {
  try { return value && Object.getOwnPropertyDescriptor(value, key)?.value; } catch { return undefined; }
};
const excerpt = (value, fallback, maximum) => redactDiagnosticText(typeof value === 'string' ? value : fallback, maximum);
const projectFields = (value, keys) => value && typeof value === 'object' ? Object.fromEntries(keys.map(key => {
  const field = data(value, key);
  return [key, typeof field === 'boolean' || typeof field === 'number' && Number.isFinite(field) ? field
    : ['scope', 'method'].includes(key) && typeof field === 'string' ? excerpt(field, '', 128) : null];
})) : null;

export const runBakeoffBuildChild = async ({ args, env, cwd, label, signal, onProgress, onStdout = () => {}, onDiagnostic }) => {
  const result = await spawnSubprocess(process.execPath, args, { cwd, env, signal,
    stdio: ['ignore', 'pipe', 'pipe'], captureStdout: false, captureStderr: true,
    maxOutputBytes: 32 * 1024, outputMode: 'string', onStdout,
    onStderr: chunk => { onProgress?.(chunk); onDiagnostic?.(chunk); }, rejectOnNonZeroExit: false });
  if (result.exitCode !== 0 || result.signal) {
    const reason = result.signal ? `signal=${result.signal}` : `exit=${result.exitCode ?? 'unknown'}`;
    throw new SubprocessError(`${label} failed (${reason})${result.stderr ? '\n' + result.stderr.trim() : ''}`, result);
  }
  return result;
};

/** JSON stdout is one complete bounded result. Stderr feeds the phase's bounded
 * status adapter without becoming another stdout parser or retained log array. */
export const runBakeoffJsonChild = async ({ args, env, cwd, label, signal, onProgress }) => {
  const result = await spawnSubprocess(process.execPath, args, { cwd, env, signal, name: label,
    stdio: ['ignore', 'pipe', 'pipe'], captureStdout: true, captureStderr: true,
    maxOutputBytes: 64 * 1024 * 1024, outputMode: 'string', onStderr: onProgress });
  const capture = result.outputCapture?.stdout;
  if (!capture?.enabled || capture.truncated || capture.encodingLoss || capture.droppedBytes !== 0) throw Object.assign(
    new Error(`${label} returned incomplete JSON output.`), { code: 'ERR_BAKEOFF_JSON_CAPTURE', result });
  try {
    const parsed = JSON.parse(result.stdout);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('JSON result must be an object.');
    return parsed;
  } catch (cause) {
    throw Object.assign(new Error(`${label} returned invalid JSON.`, { cause }), { code: 'ERR_BAKEOFF_JSON_RESULT', result });
  }
};

export const bakeoffPhaseFailureReceipt = error => {
  const pending = [error], visited = new Set();
  let result = null;
  while (pending.length && visited.size < 16) {
    const item = pending.shift();
    if (!item || typeof item !== 'object' || visited.has(item)) continue;
    visited.add(item); result ||= data(item, 'result');
    pending.push(data(item, 'cause'));
    const errors = data(item, 'errors');
    if (errors && typeof errors === 'object') for (let i = 0; i < 8; i++) pending.push(data(errors, String(i)));
  }
  const code = data(error, 'code'), stderr = data(result, 'stderr'), stdout = data(result, 'stdout');
  const capture = data(result, 'outputCapture'), marker = data(error, 'cacheOwnershipPending');
  return { code: excerpt(code, 'ERR_BAKEOFF_PHASE', 128),
    message: excerpt(data(error, 'message'), 'Bakeoff phase failed.', 2048),
    stderrTail: typeof stderr === 'string' ? excerpt(stderr.slice(-4096), '', 4096) : null,
    stdoutTail: typeof stdout === 'string' ? excerpt(stdout.slice(-4096), '', 4096) : null,
    exitCode: Number.isInteger(data(result, 'exitCode')) ? data(result, 'exitCode') : null,
    signal: typeof data(result, 'signal') === 'string' ? data(result, 'signal') : null,
    reportedOwnershipPending: typeof marker === 'boolean' ? marker : null,
    relatedFailures: [...visited].slice(1, 9).map(item => ({ code: typeof data(item, 'code') === 'string' ? excerpt(data(item, 'code'), '', 128) : null,
      message: excerpt(data(item, 'message'), 'Related phase failure.', 512) })),
    outputCapture: capture ? Object.fromEntries(['stdout', 'stderr'].map(stream => [stream, projectFields(data(capture, stream),
      ['enabled', 'maxBytes', 'observedBytes', 'retainedBytes', 'droppedBytes', 'retainedBufferBytes', 'outputBytes', 'encodingLoss', 'truncated'])])) : null,
    termination: projectFields(data(result, 'termination'), ['scope', 'method', 'closeObserved', 'closeTimedOut', 'waitMs',
      'treeCleanupSettled', 'treeCleanupFailed', 'treeCleanupForced']) };
};

/** One bakeoff phase owns its timer, child wait, display and checkpoints. Child
 * settlement stays with the shared runner; this owner only clears its timer. */
export const runBakeoffPhase = async ({ modelId, phaseName, display, task, total, completed,
  run, checkpoint, onState = () => {}, signal, heartbeatMs = 1500 }) => {
  if (!Number.isSafeInteger(heartbeatMs) || heartbeatMs < 1 || heartbeatMs > 1500) throw new TypeError('Private phase heartbeat may only shorten the normal interval.');
  const startedAtMs = Date.now(), abort = new AbortController();
  const effectiveSignal = composeAbortSignals(signal, abort.signal);
  let state = { version: BAKEOFF_PHASE_STATE_VERSION, modelId, phase: phaseName, state: 'started',
    startedAt: new Date(startedAtMs).toISOString(), elapsedMs: 0,
    childProgress: { observation: 'waiting', message: null, observedAt: null } };
  let timer = null, result, failed = false, primary, lastDisplayAt = 0;
  const remember = error => {
    primary = failed ? addStorageFailureContext(primary, {}, error, { secondaryPresent: true }) : error;
    failed = true;
  };
  const setState = next => { state = { ...state, ...next, elapsedMs: Math.max(0, Date.now() - startedAtMs) }; onState(state); };
  const render = () => {
    const suffix = state.childProgress.message ? ` · child: ${state.childProgress.message}` : ' · waiting for child';
    task?.set(completed(), total, { message: `${phaseName} running (${formatElapsed(startedAtMs)})${suffix}` });
    lastDisplayAt = Date.now();
  };
  const onProgress = chunk => {
    const text = typeof chunk === 'string' ? chunk : '';
    const line = text.slice(-2048).split(/\r?\n/u).map(value => value.trim()).filter(Boolean).at(-1);
    if (!line) return;
    setState({ childProgress: { observation: 'diagnostic-available', message: redactDiagnosticText(line, 384),
      observedAt: new Date().toISOString() } });
    if (Date.now() - lastDisplayAt >= 100) render();
  };
  try {
    throwIfAborted(effectiveSignal);
    onState(state);
    display.log(`[bakeoff] ${modelId}: ${phaseName} started`, { kind: 'status', stage: 'bakeoff' });
    setState({ state: 'running' }); await checkpoint(state); render();
    timer = setInterval(() => {
      try { setState({ state: 'running' }); render(); }
      catch (error) { clearInterval(timer); timer = null; remember(error); abort.abort(error); }
    }, heartbeatMs);
    result = await run({ signal: effectiveSignal, onProgress });
    throwIfAborted(effectiveSignal);
  } catch (error) { remember(error); }
  finally { if (timer) clearInterval(timer); }

  const cancelled = signal?.aborted || data(primary, 'code') === 'ABORT_ERR' && !abort.signal.aborted;
  let terminal = failed ? cancelled ? 'cancelled' : 'failed' : 'succeeded';
  // Persist success before announcing it. A checkpoint failure is a failed
  // phase and must never be followed by a completed-success log.
  try {
    const next = { ...state, state: terminal, elapsedMs: Math.max(0, Date.now() - startedAtMs),
      ...(failed ? { failure: bakeoffPhaseFailureReceipt(primary) } : {}) };
    await checkpoint(next); setState(next);
  } catch (error) {
    remember(error); terminal = 'failed';
    try {
      setState({ state: terminal, failure: bakeoffPhaseFailureReceipt(primary) }); await checkpoint(state);
    } catch (secondary) { remember(secondary); }
  }
  try {
    if (failed) {
      task?.fail(new Error(`${phaseName} ${terminal} (${formatElapsed(startedAtMs)})`));
      display.log(`[bakeoff] ${modelId}: ${phaseName} ${terminal} in ${formatElapsed(startedAtMs)}`, { kind: 'status', stage: 'bakeoff' });
    } else {
      task?.set(completed(), total, { message: `${phaseName} done (${formatElapsed(startedAtMs)})` });
      display.log(`[bakeoff] ${modelId}: ${phaseName} completed in ${formatElapsed(startedAtMs)}`, { kind: 'status', stage: 'bakeoff' });
    }
  } catch (error) {
    remember(error);
    try { setState({ state: 'failed', failure: bakeoffPhaseFailureReceipt(primary) }); await checkpoint(state); }
    catch (secondary) { remember(secondary); }
  }
  if (failed) throw primary;
  return result;
};

export const persistBakeoffFailure = async (error, write) => {
  try { await write(); }
  catch (secondary) { throw addStorageFailureContext(error, {}, secondary, { secondaryPresent: true }); }
  throw error;
};
