import { createFramedJsonRpcParser, getJsonRpcWriter } from '../../../src/shared/jsonrpc.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';

const fault = (code, message) => Object.assign(new Error(message), { code });
const MAX_BYTES = 768 * 1024;

/** One owned process and a bounded framed protocol. Raw output never enters logs.
 * Cancellation keeps its admission slot until the server settles or the owned
 * process tree has actually closed. This is a client, not a second job queue.
 */
export const createOwnedStdioClient = ({ command, args, cwd, env, signal, onSpawn,
  onActivity = () => {}, spawn = spawnSubprocess, maxPending = 4, maxBytes = MAX_BYTES } = {}) => {
  if (!Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 4
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > MAX_BYTES) throw new TypeError('Invalid client bounds.');
  const controller = new AbortController();
  const pending = new Map();
  let writer = null, nextId = 1, closed = false, failure = null, writes = 0, opening = 0;
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // A caller can close before awaiting readiness; still observe the rejection.
  ready.catch(() => {});
  const stop = error => {
    failure ||= error;
    if (!controller.signal.aborted) controller.abort(error);
  };
  const send = async payload => {
    if (closed || !writer || controller.signal.aborted) throw failure || fault('ERR_TUI_STDIO_CLOSED', 'The owned protocol is closed.');
    if (writes >= 8 || Buffer.byteLength(JSON.stringify(payload)) > maxBytes) {
      throw fault('ERR_TUI_STDIO_ADMISSION', 'The protocol write bound was reached.');
    }
    writes += 1;
    try { await writer.write(payload); }
    catch (error) { stop(fault('ERR_TUI_STDIO_WRITE', 'The owned protocol write failed.')); throw error; }
    finally { writes -= 1; }
  };
  const settle = (entry, error, value) => {
    if (!pending.delete(entry.id)) return;
    clearTimeout(entry.timer); clearTimeout(entry.grace);
    entry.signal?.removeEventListener('abort', entry.abort);
    if (error || entry.cancelled) entry.reject(error || fault('ABORT_ERR', 'Request cancelled.'));
    else entry.resolve(value);
  };
  const parser = createFramedJsonRpcParser({ maxBufferBytes: maxBytes + 8192, maxHeaderBytes: 8192,
    maxMessageBytes: maxBytes,
    onError: () => stop(fault('ERR_TUI_STDIO_FRAME', 'Invalid or oversized protocol frame.')),
    onMessage: message => {
      if (!message || message.jsonrpc !== '2.0' || typeof message !== 'object') {
        stop(fault('ERR_TUI_STDIO_PROTOCOL', 'Invalid protocol envelope.')); return;
      }
      if (Object.hasOwn(message, 'method')) {
        // The admitted servers send only progress notifications. No client
        // request, credential prompt, or unsolicited data grants authority.
        if (message.id !== undefined || message.method !== 'notifications/progress') {
          stop(fault('ERR_TUI_STDIO_UNSOLICITED', 'Unexpected server request or notification.')); return;
        }
        onActivity({ kind: 'notification' }); return;
      }
      const entry = pending.get(message.id);
      if (!entry || Object.hasOwn(message, 'result') === Object.hasOwn(message, 'error')) {
        stop(fault('ERR_TUI_STDIO_RESPONSE', 'Unexpected or duplicate protocol response.')); return;
      }
      onActivity({ kind: 'response' });
      const remoteCode = message.error?.data?.code;
      settle(entry, message.error ? fault(typeof remoteCode === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(remoteCode)
        ? remoteCode : 'ERR_TUI_STDIO_REMOTE', 'The protocol request failed.') : null, message.result);
    } });
  const externalAbort = () => stop(fault('ABORT_ERR', 'Owned protocol cancelled.'));
  signal?.addEventListener('abort', externalAbort, { once: true });
  if (signal?.aborted) externalAbort();
  const completion = Promise.resolve().then(() => spawn(command, args, { cwd, env,
    stdio: ['pipe', 'pipe', 'pipe'], captureStdout: false, captureStderr: false,
    rejectOnNonZeroExit: false, signal: controller.signal,
    onSpawn: child => {
      try {
        writer = getJsonRpcWriter(child.stdin);
        onSpawn?.(child);
        resolveReady();
      } catch { stop(fault('ERR_TUI_STDIO_START', 'Could not attach the owned protocol.')); }
    },
    onStdout: chunk => parser.push(chunk),
    // stderr is intentionally discarded; it can contain private configuration.
    onStderr: () => {} })).then(result => ({ exitCode: result.exitCode, signal: result.signal || null }),
  () => ({ exitCode: null, signal: null })).then(result => {
    closed = true;
    writer?.close(); parser.dispose();
    signal?.removeEventListener('abort', externalAbort);
    const error = failure || fault('ERR_TUI_STDIO_EXIT', 'The owned protocol process exited.');
    rejectReady(error);
    for (const entry of pending.values()) settle(entry, error);
    return { ...result, failureCode: failure?.code || null };
  });
  const request = async (method, params = {}, { signal: requestSignal, timeoutMs = 10000 } = {}) => {
    if (typeof method !== 'string' || !/^[a-zA-Z0-9_/$.-]{1,80}$/.test(method)
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new TypeError('Invalid protocol request.');
    if (Buffer.byteLength(JSON.stringify({ jsonrpc: '2.0', id: nextId, method, params })) > maxBytes) {
      throw fault('ERR_TUI_STDIO_ADMISSION', 'The protocol request exceeds its byte bound.');
    }
    if (pending.size + opening >= maxPending) throw fault('ERR_TUI_STDIO_ADMISSION', 'The protocol request bound was reached.');
    if (requestSignal?.aborted) throw fault('ABORT_ERR', 'Request cancelled.');
    opening += 1;
    const beforeReadyAbort = () => stop(fault('ABORT_ERR', 'Request cancelled before child startup settled.'));
    requestSignal?.addEventListener('abort', beforeReadyAbort, { once: true });
    try { await ready; }
    finally { opening -= 1; requestSignal?.removeEventListener('abort', beforeReadyAbort); }
    if (requestSignal?.aborted) throw fault('ABORT_ERR', 'Request cancelled.');
    if (closed || controller.signal.aborted) throw failure || fault('ERR_TUI_STDIO_CLOSED', 'The protocol is closed.');
    if (pending.size >= maxPending) throw fault('ERR_TUI_STDIO_ADMISSION', 'The protocol request bound was reached.');
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const entry = { id, resolve, reject, signal: requestSignal, cancelled: false };
      entry.abort = () => {
        if (entry.cancelled || !pending.has(id)) return;
        entry.cancelled = true;
        send({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id } }).catch(() => {});
        entry.grace = setTimeout(() => stop(fault('ERR_TUI_STDIO_CANCEL_SETTLEMENT', 'The server did not settle cancellation.')), 1000);
      };
      entry.timer = setTimeout(entry.abort, timeoutMs);
      pending.set(id, entry);
      requestSignal?.addEventListener('abort', entry.abort, { once: true });
      send({ jsonrpc: '2.0', id, method, params }).catch(() => {
        // Stop first; do not release a pending request while a child is still
        // executing work whose outcome is unknown.
        stop(fault('ERR_TUI_STDIO_WRITE', 'The owned protocol write failed.'));
      });
    });
  };
  const dispose = async () => { stop(fault('ERR_TUI_STDIO_DISPOSED', 'The session closed.')); return completion; };
  return { ready, request, completion, dispose,
    status: () => ({ connected: !closed && Boolean(writer) && !controller.signal.aborted,
      pending: pending.size, opening, maxPending, failureCode: failure?.code || null }) };
};
