import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { historyError } from './common.js';
import { normalizeHistoryVector } from './semantic-values.js';

const MAX_IPC_BYTES = 16 * 1024 * 1024;
const unavailable = message => historyError('ERR_INFERENCE_HISTORY_UNAVAILABLE', message);
const bounded = message => {
  try { return Buffer.byteLength(JSON.stringify(message)) <= MAX_IPC_BYTES; }
  catch { return false; }
};
const safeTexts = texts => Array.isArray(texts) && texts.length <= 256
  && texts.every(text => typeof text === 'string')
  && texts.reduce((sum, text) => sum + Buffer.byteLength(text), 0) <= 4 * 1024 * 1024;

/** A single positively-owned CPU child; cancellation drains then kills after <=1s grace.
 * Termination is confirmed ONLY by child exit. Native timeout never authorizes resubmission.
 */
export function createEg2WorkerRuntime(config, {
  readinessMs = 10000, graceMs = 1000, maxHeapMb = 8192,
  confirmationMs = 2000,
  workerPath = fileURLToPath(new URL('./eg2-worker-entry.js', import.meta.url)),
  spawnImpl = fork, terminateImpl = ownedChild => ownedChild.kill('SIGKILL')
} = {}) {
  if (!Number.isSafeInteger(readinessMs) || readinessMs < 1 || readinessMs > 60000
    || !Number.isSafeInteger(graceMs) || graceMs < 0 || graceMs > 1000
    || !Number.isSafeInteger(maxHeapMb) || maxHeapMb < 128 || maxHeapMb > 8192
    || !Number.isSafeInteger(confirmationMs) || confirmationMs < 1 || confirmationMs > 30000) {
    throw historyError('ERR_INFERENCE_HISTORY_INPUT', 'Invalid isolated EG2 worker bounds.');
  }
  const nonce = randomBytes(32).toString('hex');
  const handles = new WeakMap();
  let child = null, started = false, ready = false, exited = false, draining = false;
  let pending = null, nextId = 1, readyTimer = null, killTimer = null, confirmationTimer = null;
  let admitted = false, forced = false, ownedPid = null;
  let latestInfo = {}, cancelReason = null, exitInfo = null;
  let resolveReady, rejectReady, resolveExit;
  const readiness = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  readiness.catch(() => {});
  const exit = new Promise(resolve => { resolveExit = resolve; });
  exit.catch(() => {});
  let cancellation = null;
  let spawnedAt=null,requestedAt=null,forceRequestedAt=null,exitedAt=null;
  const send = message => {
    if (!child?.connected || exited || !bounded(message)) throw unavailable('EG2 worker IPC is unavailable or exceeds its budget.');
    child.send(message, error => {
      if (error && !exited) void cancel(unavailable('EG2 worker IPC send failed.'));
    });
  };
  const onExit = (code, signal) => {
    if (exited) return;
    exited = true;
    clearTimeout(readyTimer); clearTimeout(killTimer); clearTimeout(confirmationTimer);
    const terminationMode = code === 23 ? 'self-watchdog' : forced ? 'parent-forced'
      : draining && code === 0 ? 'cooperative' : 'unexpected';
    exitedAt=new Date().toISOString();
    exitInfo = { requestAccepted: draining, workerStopped: true, spawnedAt,requestedAt,forceRequestedAt,exitedAt, forced: forced || code === 23,
      terminationMode, exitCode: code, signal, confirmed: true };
    const error = cancelReason ?? unavailable('EG2 worker exited; no automatic restart is permitted.');
    rejectReady(error);
    if (pending) { pending.cleanup(); pending.reject(error); pending = null; }
    resolveExit(exitInfo);
  };
  const cancel = (reason = unavailable('EG2 worker cancelled; interrupted work must be replayed.')) => {
    if (exited && exitInfo?.confirmed) return Promise.resolve(exitInfo);
    if (cancellation) return cancellation;
    draining = true;requestedAt=new Date().toISOString();
    cancelReason = reason instanceof Error ? reason : unavailable(String(reason));
    if (!started) {
      exited = true;
      exitedAt=new Date().toISOString();
      exitInfo = { requestAccepted: true, workerStopped: true, spawnedAt,requestedAt,forceRequestedAt,exitedAt, forced: false, exitCode: null, signal: null, confirmed: true, terminationMode: 'never-started', neverStarted: true };
      rejectReady(cancelReason);
      resolveExit(exitInfo);
      cancellation = exit;
      return cancellation;
    }
    if (exited) { cancellation = exit; return cancellation; }
    try { send({ type: 'cancel', nonce }); } catch {}
    clearTimeout(readyTimer);
    const unconfirmed = new Promise(resolve => {
      confirmationTimer = setTimeout(() => {
        const error = unavailable('EG2 worker termination is unconfirmed; native work may still be active.');
        rejectReady(error);
        if (pending) { pending.cleanup(); pending.reject(error); pending = null; }
        resolve({ requestAccepted: true, workerStopped: false, spawnedAt,requestedAt,forceRequestedAt,exitedAt,
          forced, terminationMode: 'unconfirmed', exitCode: null, signal: null, confirmed: false });
      }, graceMs + confirmationMs);
    });
    killTimer = setTimeout(() => {
      if (exited || child.pid !== ownedPid || child.exitCode !== null || child.signalCode !== null) return;
      // No descendant processes are spawned by the CPU-only entry; ORT owns native threads.
      // Use the original live ChildProcess native handle, never ancestry/PID enumeration.
      forceRequestedAt=new Date().toISOString();
      Promise.resolve().then(() => {
        const result = terminateImpl(child);
        if (result && typeof result.then === 'function') {
          return result.then(receipt => { forced = receipt === true || receipt?.forced === true; });
        }
        forced = result === true || result?.forced === true;
      }).catch(() => {});
    }, graceMs);
    cancellation = Promise.race([exit, unconfirmed]);
    return cancellation;
  };
  const failProtocol = () => { void cancel(unavailable('EG2 worker protocol validation failed.')); };
  const onMessage = message => {
    if (!message || typeof message !== 'object' || message.nonce !== nonce || !bounded(message)) {
      failProtocol(); return;
    }
    if (message.type === 'ready') {
      if (ready || message.pid !== child.pid || draining) { failProtocol(); return; }
      if (message.info && typeof message.info === 'object' && !Array.isArray(message.info)) latestInfo = message.info;
      ready = true; clearTimeout(readyTimer); resolveReady(); return;
    }
    if (draining) return; // Never publish late native results.
    if (message.type !== 'result' || !pending || message.id !== pending.id
      || !Number.isSafeInteger(message.id) || typeof message.ok !== 'boolean') {
      failProtocol(); return;
    }
    const current = pending;
    pending = null; current.cleanup();
    if (message.info && typeof message.info === 'object' && !Array.isArray(message.info)) latestInfo = message.info;
    if (!message.ok) {
      current.reject(unavailable('EG2 child encoder failed; inspect its qualified cache/configuration.'));
    } else {
      current.resolve(message.value);
    }
  };
  const start = () => {
    if (started || draining || exited) return;
    started = true;
    try {
      child = spawnImpl(workerPath, [], {
        execPath: process.execPath, execArgv: ['--max-old-space-size=' + maxHeapMb],
        windowsHide: true, detached: process.platform !== 'win32',
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'advanced'
      });
      ownedPid = child.pid;spawnedAt=new Date().toISOString();
      child.on('message', onMessage);
      child.once('exit', onExit);
      child.once('error', error => {
        if (!child.pid) {
          rejectReady(unavailable('EG2 worker failed to spawn.'));
          onExit(null, null);
        } else void cancel(error);
      });
      child.once('disconnect', () => { if (!exited && !draining) void cancel(unavailable('EG2 worker disconnected.')); });
      readyTimer = setTimeout(() => { void cancel(unavailable('EG2 worker readiness deadline elapsed.')); }, readinessMs);
      send({ type: 'init', nonce, config });
    } catch (error) {
      rejectReady(error);
      if (child?.pid) void cancel(error);
      else onExit(null, null);
    }
  };
  const request = async (method, value, signal) => {
    signal?.throwIfAborted();
    if (draining || exited) throw cancelReason ?? unavailable('EG2 worker is terminal; create a new explicitly authorized runtime.');
    if (admitted) throw historyError('ERR_INFERENCE_HISTORY_LIMIT', 'EG2 worker admits one request at a time.');
    admitted = true;
    const abortReadiness = () => { void cancel(signal.reason); };
    signal?.addEventListener('abort', abortReadiness, { once: true });
    try {
      start();
      if (signal?.aborted) abortReadiness();
      await readiness;
      signal?.removeEventListener('abort', abortReadiness);
      signal?.throwIfAborted();
      if (draining || exited) throw cancelReason ?? unavailable('EG2 worker is terminal.');
      return await new Promise((resolve, reject) => {
        const id = nextId++;
        const abort = () => { void cancel(signal.reason); };
        const cleanup = () => signal?.removeEventListener('abort', abort);
        pending = { id, resolve, reject, cleanup };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) { abort(); return; }
        try { send({ type: 'request', nonce, id, method, value }); }
        catch (error) { void cancel(error); }
      });
    } finally {
      signal?.removeEventListener('abort', abortReadiness);
      admitted = false;
    }
  };
  const validateVectors = (value, count) => {
    if (!Array.isArray(value) || value.length !== count || value.some(vector =>
      !(vector instanceof Float32Array) || vector.length !== 768
      || vector.some(component => !Number.isFinite(component))
      || !vector.some(component => component !== 0))) {
      failProtocol();
      throw unavailable('EG2 child output cardinality or vector shape is invalid.');
    }
    return value;
  };
  const effectiveInput = text => config.passagePrefix + text;
  return Object.freeze({
    config, effectiveInput,
    async prepareBatch(texts, { signal } = {}) {
      if (!safeTexts(texts)) throw historyError('ERR_INFERENCE_HISTORY_LIMIT', 'EG2 preparation input exceeds IPC bounds.');
      const value = await request('prepare', texts.map(effectiveInput), signal);
      if (!Array.isArray(value) || value.length !== texts.length || value.some(item =>
        !item || !Number.isSafeInteger(item.id) || item.id < 1
        || !Number.isSafeInteger(item.tokenLength) || item.tokenLength < 1 || item.tokenLength > 8192)
        || new Set(value.map(item => item.id)).size !== value.length) {
        failProtocol(); throw unavailable('EG2 child prepared handles are invalid.');
      }
      return value.map(item => {
        const handle = Object.freeze({ tokenLength: item.tokenLength });
        handles.set(handle, { nonce, id: item.id });
        return handle;
      });
    },
    async encodePrepared(prepared, { signal } = {}) {
      if (!Array.isArray(prepared) || prepared.length > 64) throw historyError('ERR_INFERENCE_HISTORY_LIMIT', 'EG2 batch exceeds IPC bounds.');
      const ids = prepared.map(handle => {
        const identity = handles.get(handle);
        if (!identity || identity.nonce !== nonce) throw historyError('ERR_INFERENCE_HISTORY_INPUT', 'Prepared handle belongs to another worker.');
        return identity.id;
      });
      return validateVectors(await request('prepared', ids, signal), ids.length);
    },
    async encodeBatch(texts, { signal } = {}) {
      if (!safeTexts(texts) || texts.length > 64) throw historyError('ERR_INFERENCE_HISTORY_LIMIT', 'EG2 batch exceeds IPC bounds.');
      return validateVectors(await request('batch', texts.map(effectiveInput), signal), texts.length);
    },
    async encodeQuery(query, { signal } = {}) {
      if (!safeTexts([query])) throw historyError('ERR_INFERENCE_HISTORY_LIMIT', 'EG2 query exceeds IPC bounds.');
      const vectors = validateVectors(await request('query', config.queryPrefix + query, signal), 1);
      return normalizeHistoryVector(Array.from(vectors[0]).slice(0, config.profile.dimensions), config.profile.dimensions);
    },
    executionInfo() {
      return { provider: 'xenova', device: 'cpu', executionProviders: ['cpu'],
        modelFileName: config.modelFileName ?? null,
        requestedSessionOptions: structuredClone(config.sessionOptions ?? {}),
        effectiveNativeThreads: null, effectiveGraphExecutionMode: null, sessions: [],
        maxLength: config.fullProfile.maxLength, maxConcurrentInference: 1,
        profilingEnabled: config.sessionOptions?.enableProfiling === true, profilingEnded: false,
        optimizedModelFilePath: config.sessionOptions?.optimizedModelFilePath ?? null,
        ...latestInfo, loaded: latestInfo.loaded === true, loading: latestInfo.loaded !== true && pending !== null,
        cpuOnly: true, processIsolated: true,
        childPid: child?.pid ?? null, spawnedAt,requestedAt,forceRequestedAt,exitedAt,
        ownershipEvidence:'original-fork-child-handle-with-nonce-pid-handshake', ready, draining, exited, exitInfo,
        activeNativeCalls: pending ? 1 : 0, cancellationGraceMs: graceMs,
        descendantProcessesSpawned: false, terminationScope: 'original-child-native-handle',
        documentIdentityKey: config.documentIdentityKey,
        queryIdentityKey: config.queryIdentityKey, representationIdentityKey: config.representationIdentityKey };
    },
    waitForIdle() {
      if (draining) return exit;
      if (!pending) return Promise.resolve();
      return new Promise(resolve => {
        const current = pending;
        const originalResolve = current.resolve, originalReject = current.reject;
        current.resolve = value => { originalResolve(value); resolve(); };
        current.reject = error => { originalReject(error); resolve(); };
      });
    },
    endProfiling() { return request('endProfiling', null); },
    cancel,
    async dispose() {
      const receipt = await cancel(unavailable('EG2 worker disposed.'));
      if (!receipt.workerStopped) throw unavailable('EG2 worker disposal is unconfirmed; no new work may be admitted.');
      return receipt;
    }
  });
}
