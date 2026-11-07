import { getJsonRpcWriter, getJsonRpcWriteEvidence, prepareJsonRpcMessage } from '../../shared/jsonrpc.js';

const owners = new WeakSet();
const defaults = Object.freeze({ maxFrameBytes: 32 * 1024 * 1024, maxProgressBytes: 64 * 1024,
  maxTerminalFrames: 4, maxProgressKeys: 2, writeTimeoutMs: 5000, flushTimeoutMs: 2000 });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const outputError = (reason, message) => Object.assign(new Error(message), { code: 'ERR_MCP_OUTPUT', reason });
const progressKey = payload => {
  if (payload?.method !== 'notifications/progress' || Object.hasOwn(payload, 'id')) return null;
  const id = payload.params?.id;
  return typeof id === 'string' ? 's:' + id : Number.isSafeInteger(id) ? 'n:' + id : 'progress';
};
export const isMcpOutput = output => owners.has(output);

/** Connection-owned outbound work. Reliable producers are bounded separately
 * by transport lanes/control admission; only progress is explicitly lossy. */
export const createMcpOutput = ({ stream, onFailure = null, ...limits }) => {
  if (!stream || typeof stream.write !== 'function') throw new TypeError('MCP output requires its writable stream.');
  if (Object.keys(limits).some(key => !Object.hasOwn(defaults, key))) throw new TypeError('Unknown MCP output allowance.');
  const bounds = { ...defaults, ...limits };
  for (const [key, value] of Object.entries(bounds)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > defaults[key]) throw new TypeError('Invalid MCP output allowance: ' + key);
  }
  let writer = null, active = null, closing = false, sealed = false, failure = null;
  let writeTimer = null, flushTimer = null, finishPromise = null, finishWaiter = null;
  let retainedBytes = 0, peakBytes = 0, terminalFrames = 0, writerRetired = false;
  const terminals = [], progress = new Map();
  const stats = { admittedTerminalFrames: 0, deliveredTerminalFrames: 0, unsentTerminalFrames: 0,
    unconfirmedTerminalFrames: 0, rejectedTerminalFrames: 0, lateDeliveredTerminalFrames: 0,
    deliveredProgressFrames: 0, coalescedProgressFrames: 0, droppedProgressFrames: 0 };
  const clearTimers = () => {
    if (writeTimer) clearTimeout(writeTimer); if (flushTimer) clearTimeout(flushTimer);
    writeTimer = null; flushTimer = null;
  };
  const snapshot = () => ({ schemaVersion: 1, status: failure ? 'failed' : sealed && !active && !terminals.length ? 'drained' : closing ? 'draining' : 'open',
    retainedWireBytes: retainedBytes, peakRetainedWireBytes: peakBytes, pendingTerminalFrames: terminalFrames,
    pendingProgressFrames: progress.size + (active?.lossy ? 1 : 0), physicalWritePending: Boolean(active),
    writerRetired, streamClosed: stream.destroyed === true || stream.writableFinished === true,
    ...stats, ...(failure ? { failure: { code: typeof failure.code === 'string' ? failure.code.slice(0, 128) : 'ERR_MCP_OUTPUT',
      reason: typeof failure.reason === 'string' ? failure.reason.slice(0, 128) : 'write-failed' } } : {}) });
  const detach = () => { stream.off('error', onStreamError); stream.off('close', onStreamClose); stream.off('finish', onStreamClose); };
  const retire = () => { if (writer) writer.close(); writerRetired = true; };
  const complete = () => {
    if (!active && !terminals.length && !progress.size) {
      if (flushTimer) clearTimeout(flushTimer); flushTimer = null;
      if (sealed || failure) { retire(); detach(); finishWaiter?.resolve(snapshot()); }
    } else if (failure) finishWaiter?.resolve(snapshot());
  };
  const discardProgress = entry => {
    retainedBytes -= entry.wireBytes; stats.droppedProgressFrames++; entry.resolve();
  };
  const fail = error => {
    if (failure) return;
    failure = error; closing = true; clearTimers();
    for (const entry of terminals.splice(0)) {
      retainedBytes -= entry.wireBytes; terminalFrames--; stats.unsentTerminalFrames++; entry.reject(error);
    }
    for (const entry of progress.values()) discardProgress(entry);
    progress.clear();
    if (active) {
      active.reportedFailure = true;
      if (!active.lossy) stats.unconfirmedTerminalFrames++;
      active.reject(error);
    }
    retire();
    // Retirement does not dispose a live physical write. Its original native
    // promise below retains framing ownership until actual callback settlement.
    complete();
    try { onFailure?.(error, snapshot()); }
    catch { stats.failureObserverFailed = true; }
  };
  const armFlush = () => {
    if (closing && !failure && !flushTimer && (active || terminals.length || progress.size)) {
      flushTimer = setTimeout(() => fail(outputError('flush-timeout', 'MCP output flush deadline exceeded.')), bounds.flushTimeoutMs);
    }
  };
  const pump = () => {
    if (active || failure) { complete(); return; }
    let entry = terminals.shift();
    if (!entry && progress.size) {
      const key = progress.keys().next().value; entry = progress.get(key); progress.delete(key);
    }
    if (!entry) { complete(); return; }
    active = entry;
    const settle = () => {
      if (writeTimer) clearTimeout(writeTimer); writeTimer = null;
      retainedBytes -= entry.wireBytes;
      if (!entry.lossy) terminalFrames--;
      active = null; pump();
    };
    let native;
    try {
      writer ||= getJsonRpcWriter(stream);
      writeTimer = setTimeout(() => fail(outputError('write-timeout', 'MCP output write deadline exceeded.')), bounds.writeTimeoutMs);
      armFlush(); native = writer.write(entry.prepared); entry.native = native;
    } catch (error) {
      fail(error);
      if (!entry.lossy) { stats.unconfirmedTerminalFrames--; stats.unsentTerminalFrames++; }
      settle(); return;
    }
    native.then(() => {
      if (entry.lossy) stats.deliveredProgressFrames++;
      else {
        stats.deliveredTerminalFrames++;
        if (entry.reportedFailure) { stats.unconfirmedTerminalFrames--; stats.lateDeliveredTerminalFrames++; }
      }
      settle();
      if (!entry.reportedFailure) entry.resolve();
    }, error => {
      if (!failure) fail(error);
      if (!entry.lossy && entry.reportedFailure && getJsonRpcWriteEvidence(native)?.frameStarted === false) {
        stats.unconfirmedTerminalFrames--; stats.unsentTerminalFrames++;
      }
      settle();
    }).catch(error => fail(error));
  };
  const onStreamError = error => fail(error);
  const onStreamClose = () => {
    if (!sealed || active || terminals.length || progress.size) fail(outputError('stream-closed', 'MCP output stream closed before delivery settled.'));
    else { retire(); detach(); }
  };
  const output = {
    write(payload) {
      const key = progressKey(payload), lossy = key !== null;
      if (failure || sealed || (closing && lossy)) {
        if (lossy) { stats.droppedProgressFrames++; return Promise.resolve(); }
        stats.rejectedTerminalFrames++; return Promise.reject(failure || outputError('output-sealed', 'MCP output no longer admits responses.'));
      }
      if (!lossy && terminalFrames >= bounds.maxTerminalFrames) {
        stats.rejectedTerminalFrames++;
        const error = outputError('terminal-admission-limit', 'MCP outbound producer admission exceeded its reserved headroom.');
        fail(error); return Promise.reject(error);
      }
      if (lossy && !progress.has(key) && progress.size >= bounds.maxProgressKeys) {
        stats.droppedProgressFrames++; return Promise.resolve();
      }
      let prepared;
      try { prepared = prepareJsonRpcMessage(payload, { maxBytes: lossy ? bounds.maxProgressBytes : bounds.maxFrameBytes }); }
      catch (error) {
        if (lossy && error.code === 'ERR_JSONRPC_MESSAGE_LIMIT') { stats.droppedProgressFrames++; return Promise.resolve(); }
        stats.rejectedTerminalFrames++; return Promise.reject(error);
      }
      const wireBytes = prepared.byteLength + Buffer.byteLength('Content-Length: ' + prepared.byteLength + '\r\n\r\n');
      const entry = { ...deferred(), prepared, wireBytes, lossy, reportedFailure: false };
      if (lossy) {
        const previous = progress.get(key);
        if (previous) {
          retainedBytes -= previous.wireBytes; stats.coalescedProgressFrames++; previous.resolve();
        }
        progress.set(key, entry);
      } else { terminals.push(entry); terminalFrames++; stats.admittedTerminalFrames++; }
      retainedBytes += wireBytes; peakBytes = Math.max(peakBytes, retainedBytes);
      pump(); armFlush();
      return entry.promise;
    },
    beginClose() {
      closing = true;
      for (const entry of progress.values()) discardProgress(entry);
      progress.clear(); armFlush(); complete();
    },
    finish() {
      if (finishPromise) return finishPromise;
      output.beginClose(); sealed = true;
      finishWaiter = deferred(); finishPromise = finishWaiter.promise;
      complete(); return finishPromise;
    },
    abort: fail,
    getState: snapshot
  };
  owners.add(output);
  stream.on('error', onStreamError); stream.on('close', onStreamClose); stream.on('finish', onStreamClose);
  return output;
};
