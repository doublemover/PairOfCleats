import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  closeJsonRpcWriter,
  createFramedJsonRpcParser,
  getJsonRpcWriter,
  getJsonRpcWriteEvidence,
  isClosedStreamWriteError
} from '../../../shared/jsonrpc.js';
import { registerChildProcessForCleanup } from '../../../shared/subprocess/tracking-register.js';
import { resolveWindowsCmdInvocation } from '../../../shared/subprocess/windows-cmd.js';
import { killChildProcessTree, killChildProcessTreeSync } from '../../../shared/kill-tree.js';
import { applyToolchainDaemonPolicyEnv } from '../../../shared/toolchain-env.js';
import { resolveNearestRankPercentile } from '../../../shared/perf/percentiles.js';
import { createJsonRpcTraceRecorder } from './trace.js';
import { classifyLspEnvelope } from './response-envelope.js';
import { addStorageFailureContext } from '../../../shared/storage/operation-error.js';

/**
 * Convert a local path to a file:// URI.
 * @param {string} absPath
 * @returns {string}
 */
export function pathToFileUri(absPath) {
  return pathToFileURL(path.resolve(absPath)).href;
}

const LANGUAGE_ID_BY_EXT = Object.freeze({
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.c': 'c',
  '.h': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
  '.mm': 'objective-cpp',
  '.m': 'objective-c',
  '.swift': 'swift',
  '.py': 'python',
  '.pyi': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.lua': 'lua',
  '.rb': 'ruby',
  '.php': 'php',
  '.cs': 'csharp',
  '.dart': 'dart',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.hrl': 'erlang',
  '.hs': 'haskell',
  '.lhs': 'haskell',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.zig': 'zig',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.sh': 'shellscript',
  '.bash': 'shellscript',
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.gql': 'graphql'
});

/**
 * Map file extensions to LSP language identifiers.
 * @param {string} ext
 * @returns {string}
 */
export function languageIdForFileExt(ext) {
  const normalized = ext.toLowerCase();
  return LANGUAGE_ID_BY_EXT[normalized] || 'plaintext';
}

const LATENCY_SAMPLE_CAP = 4096;
const DEFAULT_LSP_POSITION_ENCODINGS = Object.freeze(['utf-16', 'utf-8', 'utf-32']);

const mergeInitializeCapabilities = (value) => {
  const source = value && typeof value === 'object' ? value : {};
  const general = source.general && typeof source.general === 'object'
    ? source.general
    : {};
  const textDocument = source.textDocument && typeof source.textDocument === 'object'
    ? source.textDocument
    : {};
  return {
    ...source,
    general: {
      ...general,
      positionEncodings: Array.isArray(general.positionEncodings) && general.positionEncodings.length
        ? general.positionEncodings
        : DEFAULT_LSP_POSITION_ENCODINGS
    },
    // Modern servers negotiate the standard capability above. Keep the legacy
    // extension available when a caller explicitly selects it.
    ...(Object.hasOwn(source, 'offsetEncoding') ? {
      offsetEncoding: Array.isArray(source.offsetEncoding) && source.offsetEncoding.length
        ? source.offsetEncoding : DEFAULT_LSP_POSITION_ENCODINGS
    } : {}),
    textDocument: {
      ...textDocument,
      documentSymbol: {
        hierarchicalDocumentSymbolSupport: true,
        ...(textDocument.documentSymbol && typeof textDocument.documentSymbol === 'object'
          ? textDocument.documentSymbol
          : {})
      }
    }
  };
};

const pushLatencySample = (samples, value, cap = LATENCY_SAMPLE_CAP) => {
  if (!Array.isArray(samples)) return 0;
  samples.push(value);
  let removedTotal = 0;
  if (samples.length > cap) {
    const removed = samples.splice(0, samples.length - cap);
    for (const sample of removed) {
      if (Number.isFinite(sample) && sample >= 0) {
        removedTotal += sample;
      }
    }
  }
  return removedTotal;
};

const summarizeLatencies = (samples, totalMs, maxMs) => ({
  count: Array.isArray(samples) ? samples.length : 0,
  avg: Number.isFinite(totalMs) && Array.isArray(samples) && samples.length
    ? totalMs / samples.length
    : 0,
  max: Number.isFinite(maxMs) ? maxMs : 0,
  p50: resolveNearestRankPercentile(samples, 0.5),
  p95: resolveNearestRankPercentile(samples, 0.95)
});

/**
 * Create a minimal JSON-RPC client for LSP servers.
 * @param {{
 *   cmd:string,
 *   args?:string[],
 *   cwd?:string,
 *   env?:object,
 *   log?:(msg:string)=>void,
 *   onNotification?:(msg:object)=>void,
 *   onRequest?:(msg:object)=>Promise<any>,
 *   providerId?:string,
 *   sessionKey?:string,
 *   tracePath?:string,
 *   spawnProcess?:(input:{cmd:string,args:string[],options:import('node:child_process').SpawnOptionsWithoutStdio,rawCmd:string,rawArgs:string[],useShell:boolean})=>import('node:child_process').ChildProcess
 * }} options
 */
export function createLspClient(options) {
  const {
    cmd,
    args = [],
    cwd,
    env,
    shell,
    log = () => {},
    onNotification,
    onRequest,
    providerId,
    sessionKey,
    tracePath,
    onLifecycleEvent,
    onStderrLine,
    stderrFilter,
    maxBufferBytes,
    maxHeaderBytes,
    maxMessageBytes,
    spawnProcess,
    beforeSpawn
  } = options || {};
  if (!cmd) throw new Error('createLspClient requires a command.');
  const useShell = typeof shell === 'boolean'
    ? shell
    : (process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd));
  const killTreeDetached = process.platform !== 'win32';
  const resolvedEnv = applyToolchainDaemonPolicyEnv(env || process.env, { cwd });
  const traceRecorder = createJsonRpcTraceRecorder({
    tracePath: tracePath || resolvedEnv.POC_LSP_RPC_TRACE || '',
    providerId: providerId || cmd,
    sessionKey: sessionKey || null,
    log
  });

  let proc = null;
  let parser = null;
  let writer = null;
  let writerClosed = false;
  let trackedChildProcess = null;
  const unregisterChildProcessByChild = new WeakMap();
  const pendingTerminations = new Set();
  const childResources = new Set();
  const resourceClosures = new Map();
  const pendingTreeCleanup = new Set();
  const failedTreeCleanup = new Set();
  const resourceSettlementObservers = new Set();
  let unknownSpawnResource = false;
  const staleReapInFlight = new WeakMap();
  const STALE_REAP_RETRY_MS = 500;
  let nextId = 1;
  const pending = new Map();
  let generation = 0, uncorrelatedProtocolEvents = 0;
  let backoffMs = 0;
  let nextStartAt = 0;
  // Ensure every LSP request is bounded unless explicitly disabled.
  const DEFAULT_REQUEST_TIMEOUT_MS = 60000;
  const requestMetrics = {
    requests: 0,
    succeeded: 0,
    failed: 0,
    timedOut: 0,
    protocolFailed: 0,
    localWriteFailed: 0,
    latencySamplesMs: [],
    latencyTotalMs: 0,
    latencyMaxMs: 0,
    byMethod: Object.create(null)
  };
  let cachedMetricsSnapshot = null;
  let metricsSnapshotDirty = true;

  const invalidateMetricsSnapshot = () => {
    metricsSnapshotDirty = true;
    cachedMetricsSnapshot = null;
  };

  const ensureMethodMetric = (method) => {
    const key = String(method || 'unknown');
    if (!requestMetrics.byMethod[key]) {
      requestMetrics.byMethod[key] = {
        requests: 0,
        succeeded: 0,
        failed: 0,
        timedOut: 0,
        protocolFailed: 0,
        localWriteFailed: 0,
        latencySamplesMs: [],
        latencyTotalMs: 0,
        latencyMaxMs: 0
      };
      invalidateMetricsSnapshot();
    }
    return requestMetrics.byMethod[key];
  };

  const recordRequestLatency = (method, latencyMs) => {
    const value = Number(latencyMs);
    if (!Number.isFinite(value) || value < 0) return;
    const removedRequestTotal = pushLatencySample(requestMetrics.latencySamplesMs, value);
    requestMetrics.latencyTotalMs += value - removedRequestTotal;
    requestMetrics.latencyMaxMs = Math.max(requestMetrics.latencyMaxMs, value);
    const methodMetric = ensureMethodMetric(method);
    const removedMethodTotal = pushLatencySample(methodMetric.latencySamplesMs, value);
    methodMetric.latencyTotalMs += value - removedMethodTotal;
    methodMetric.latencyMaxMs = Math.max(methodMetric.latencyMaxMs, value);
    invalidateMetricsSnapshot();
  };

  const emitLifecycleEvent = (event) => {
    traceRecorder.recordLifecycle(event, {
      providerId: providerId || cmd,
      sessionKey
    });
    if (typeof onLifecycleEvent !== 'function') return;
    try {
      onLifecycleEvent({
        at: Date.now(),
        ...(event && typeof event === 'object' ? event : {})
      });
    } catch {}
  };

  const emitStderrLine = (line) => {
    if (typeof onStderrLine !== 'function') return;
    try {
      onStderrLine(String(line || ''));
    } catch {}
  };

  const rejectPending = (err) => {
    const now = Date.now();
    for (const entry of pending.values()) {
      if (entry.timeout) clearTimeout(entry.timeout);
      requestMetrics.failed += 1;
      const methodMetric = ensureMethodMetric(entry.method);
      methodMetric.failed += 1;
      recordRequestLatency(entry.method, now - Number(entry.startedAt || now));
      invalidateMetricsSnapshot();
      entry.reject(err);
    }
    pending.clear();
  };

  const rejectPendingTransportClosed = () => {
    const err = new Error('LSP transport closed.');
    err.code = 'ERR_LSP_TRANSPORT_CLOSED';
    rejectPending(err);
  };

  const isChildRunning = (child) => Boolean(
    child
    && child.exitCode === null
    && child.signalCode === null
  );

  const trackTreeCleanup = (child, promise) => {
    const tracked = Promise.resolve(promise).then(value => {
      failedTreeCleanup.delete(child);
      return value;
    }, error => {
      failedTreeCleanup.add(child);
      throw error;
    }).finally(() => {
      pendingTreeCleanup.delete(tracked);
      notifyResourceSettlement();
    });
    pendingTreeCleanup.add(tracked);
    return tracked;
  };

  const ownChildResource = child => {
    if (!child || !isEventEmitterLike(child)) {
      unknownSpawnResource = true;
      return;
    }
    childResources.add(child);
    // Exit does not settle inherited stdio or a still-running tree escalation.
    // Even malformed spawn candidates remain owned until their actual close.
    resourceClosures.set(child, new Promise(resolve => child.once('close', () => {
      childResources.delete(child);
      resourceClosures.delete(child);
      clearTrackedChild({ force: true, child });
      resolve();
      notifyResourceSettlement();
    })));
  };

  const clearTrackedChild = ({ force = false, child = null } = {}) => {
    const targetChild = child || trackedChildProcess;
    if (!targetChild) return;
    const unregisterChildProcess = unregisterChildProcessByChild.get(targetChild);
    const stillRunning = isChildRunning(targetChild);
    if (!force && stillRunning) return;
    if (typeof unregisterChildProcess === 'function') {
      try {
        unregisterChildProcess();
      } catch {}
    }
    unregisterChildProcessByChild.delete(targetChild);
    if (targetChild === trackedChildProcess) {
      trackedChildProcess = null;
    }
  };

  const clearTrackedChildIfTerminated = (child) => {
    const terminated = !isChildRunning(child);
    if (terminated) {
      clearTrackedChild({ force: true, child });
    }
    return terminated;
  };

  const waitForChildExit = (child) => new Promise((resolve) => {
    if (!isChildRunning(child)) { resolve(true); return; }
    const finish = (exited) => {
      clearTimeout(timer);
      child.off?.('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    // Keep the bounded wait referenced even when disposal unrefs the handle.
    const timer = setTimeout(() => finish(false), 2500);
    child.once('exit', onExit);
  });

  const cleanupInvalidSpawnCandidate = (child, reason = 'invalid_spawn_candidate') => {
    if (!child || typeof child !== 'object') return;
    try {
      if (child.stdin) closeJsonRpcWriter(child.stdin);
    } catch {}
    try {
      child.stdout?.destroy?.();
    } catch {}
    try {
      child.stderr?.destroy?.();
    } catch {}
    try {
      trackTreeCleanup(child, killChildProcessTree(child, {
        killTree: true,
        detached: killTreeDetached,
        graceMs: 0,
        awaitGrace: false
      })).catch(() => {});
    } catch {
      try {
        child.kill?.('SIGKILL');
      } catch {}
    }
    try {
      child.unref?.();
    } catch {}
    emitLifecycleEvent({
      kind: 'cleanup_invalid_spawn',
      reason,
      pid: Number.isFinite(Number(child?.pid)) ? Number(child.pid) : null
    });
  };

  const reapStaleChildProcess = (child, reason = 'stale_child') => {
    if (!child || !isChildRunning(child)) return;
    const lastAttemptAt = Number(staleReapInFlight.get(child) || 0);
    const nowMs = Date.now();
    if (lastAttemptAt > 0 && (nowMs - lastAttemptAt) < STALE_REAP_RETRY_MS) return;
    staleReapInFlight.set(child, nowMs);
    trackTreeCleanup(child, killChildProcessTree(child, {
      killTree: true,
      detached: killTreeDetached,
      graceMs: 0,
      awaitGrace: true
    })).then((outcome) => {
      if (!outcome || typeof outcome !== 'object') return;
      if (clearTrackedChildIfTerminated(child)) {
        staleReapInFlight.delete(child);
        if (!outcome.fallbackAttempted) return;
      }
      emitLifecycleEvent({
        kind: 'kill_diagnostics',
        reason,
        pid: Number.isFinite(Number(child?.pid)) ? Number(child.pid) : null,
        terminated: !isChildRunning(child),
        forced: outcome.forced === true,
        fallbackAttempted: outcome.fallbackAttempted === true,
        fallbackTerminated: Number(outcome.fallbackTerminated || 0)
      });
    }).catch(() => {})
      .finally(() => {
        if (!isChildRunning(child)) {
          staleReapInFlight.delete(child);
        }
      });
    try {
      if (child.stdin) closeJsonRpcWriter(child.stdin);
    } catch {}
    try {
      child.stdout?.destroy();
    } catch {}
    try {
      child.stderr?.destroy();
    } catch {}
    setTimeout(() => {
      if (isChildRunning(child)) {
        trackTreeCleanup(child, killChildProcessTree(child, {
          killTree: true,
          detached: killTreeDetached,
          graceMs: 0,
          awaitGrace: false
        })).then(() => {
          clearTrackedChildIfTerminated(child);
        }).catch(() => {});
      }
    }, 200).unref?.();
    try {
      child.unref?.();
    } catch {}
    emitLifecycleEvent({
      kind: 'reap',
      reason,
      pid: Number.isFinite(Number(child?.pid)) ? Number(child.pid) : null
    });
  };

  const isTransportRunning = () => Boolean(
    proc
    && proc.exitCode === null
    && !proc.killed
    && writer
    && !writerClosed
  );

  const isEventEmitterLike = (value) => Boolean(
    value
    && typeof value.on === 'function'
    && typeof value.once === 'function'
  );

  const isWritableLike = (value) => Boolean(
    value
    && typeof value.write === 'function'
    && typeof value.end === 'function'
    && typeof value.on === 'function'
  );

  const isReadableLike = (value) => Boolean(
    value
    && typeof value.on === 'function'
    && typeof value.destroy === 'function'
  );

  const failRequest = (id, entry, error, category = null) => {
    if (pending.get(id) !== entry) return false;
    pending.delete(id);
    if (entry.timeout) clearTimeout(entry.timeout);
    requestMetrics.failed += 1;
    const metric = ensureMethodMetric(entry.method);
    metric.failed += 1;
    if (category) { requestMetrics[category] += 1; metric[category] += 1; }
    recordRequestLatency(entry.method, Date.now() - entry.startedAt);
    invalidateMetricsSnapshot();
    entry.reject(error);
    return true;
  };

  const send = (payload, onWriteFailure = null) => {
    if (!writer || writerClosed) return false;
    const currentWriter = writer, currentGen = generation, currentChild = proc;
    traceRecorder.recordOutbound(payload, { providerId: providerId || cmd, sessionKey });
    const pendingWrite = currentWriter.write(payload);
    pendingWrite.catch(error => {
      if (writer !== currentWriter || generation !== currentGen) return;
      const evidence = getJsonRpcWriteEvidence(pendingWrite);
      const local = evidence?.settled && !evidence.frameStarted && !evidence.streamRetired
        && !isClosedStreamWriteError(error);
      onWriteFailure?.(error, local);
      if (!local) {
        writerClosed = true;
        currentWriter.close();
        const failure = addStorageFailureContext(error, { code: 'ERR_LSP_TRANSPORT_CLOSED' }, undefined, { forceAggregate: true });
        rejectPending(failure);
        reapStaleChildProcess(currentChild, 'outbound_write_failed');
      }
      emitLifecycleEvent({ kind: 'write_failed', reason: local ? 'pre-frame' : 'transport' });
    });
    return true;
  };

  const handleResponse = (message) => {
    const entry = pending.get(message.id);
    if (!entry) return;
    traceRecorder.recordInbound(message, {
      method: entry.method,
      providerId: providerId || cmd,
      sessionKey
    });
    pending.delete(message.id);
    if (entry.timeout) clearTimeout(entry.timeout);
    const latencyMs = Date.now() - Number(entry.startedAt || Date.now());
    recordRequestLatency(entry.method, latencyMs);
    const methodMetric = ensureMethodMetric(entry.method);
    if (Object.hasOwn(message, 'error')) {
      requestMetrics.failed += 1;
      methodMetric.failed += 1;
      invalidateMetricsSnapshot();
      const err = new Error(message.error.message || 'LSP request failed.');
      err.code = message.error.code;
      entry.reject(err);
      return;
    }
    requestMetrics.succeeded += 1;
    methodMetric.succeeded += 1;
    invalidateMetricsSnapshot();
    entry.resolve(message.result);
  };

  const handleRequest = async (message) => {
    const currentWriter = writer;
    const currentGen = generation;
    traceRecorder.recordInbound(message, {
      providerId: providerId || cmd,
      sessionKey
    });
    if (typeof onRequest === 'function') {
      try {
        const result = await onRequest(message);
        if (writer !== currentWriter || generation !== currentGen) return;
        send({ jsonrpc: '2.0', id: message.id, result: result ?? null });
      } catch (err) {
        if (writer !== currentWriter || generation !== currentGen) return;
        send({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32603, message: err?.message || 'LSP request failed.' }
        });
      }
      return;
    }
    send({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32601, message: 'Method not supported.' }
    });
  };

  const handleMessage = (message) => {
    const envelope = classifyLspEnvelope(message);
    if (!envelope.kind) {
      const entry = message && typeof message === 'object' && !Array.isArray(message)
        && Object.hasOwn(message, 'id') ? pending.get(message.id) : null;
      if (entry) {
        const error = new Error(`Invalid LSP response envelope (${envelope.reason}).`);
        error.code = 'ERR_LSP_PROTOCOL';
        failRequest(message.id, entry, error, 'protocolFailed');
      }
      if (entry || uncorrelatedProtocolEvents < 8) {
        if (!entry) uncorrelatedProtocolEvents += 1;
        emitLifecycleEvent({ kind: 'protocol_envelope_error', reason: envelope.reason, correlated: Boolean(entry) });
      }
      return;
    }
    if (envelope.kind === 'request') { void handleRequest(message); return; }
    if (envelope.kind === 'response') { handleResponse(message); return; }
    traceRecorder.recordInbound(message, { providerId: providerId || cmd, sessionKey });
    if (typeof onNotification === 'function') {
      try { onNotification(message); }
      catch (error) {
        log(`[lsp] notification handler failed: ${error?.message || error}`);
        emitLifecycleEvent({ kind: 'notification_handler_error', message: error?.message || String(error) });
      }
    }
  };

  const start = () => {
    beforeSpawn?.();
    if (proc) {
      if (proc.killed || proc.exitCode !== null || writerClosed) {
        const staleChild = proc;
        if (isChildRunning(staleChild)) {
          reapStaleChildProcess(staleChild, 'writer_closed_restart');
          if (isChildRunning(staleChild)) {
            const err = new Error('LSP restart blocked: previous writer-closed process is still running.');
            err.code = 'ERR_LSP_RESTART_STALE_PROCESS';
            throw err;
          }
        }
        if (staleChild.stdin) closeJsonRpcWriter(staleChild.stdin);
        parser?.dispose();
        if (!isChildRunning(staleChild)) {
          clearTrackedChild({ force: true, child: staleChild });
        }
        proc = null;
        writer = null;
        writerClosed = true;
      } else {
        return proc;
      }
    }
    if (childResources.size || pendingTreeCleanup.size || failedTreeCleanup.size || unknownSpawnResource) {
      const error = new Error('LSP restart blocked until previous child resources settle.');
      error.code = 'ERR_LSP_RESTART_STALE_PROCESS';
      throw error;
    }
    const now = Date.now();
    if (nextStartAt && now < nextStartAt) {
      throw new Error(`LSP start backoff active (${nextStartAt - now}ms remaining).`);
    }
    generation += 1;
    uncorrelatedProtocolEvents = 0;
    const childGen = generation;
    const invocation = useShell
      ? resolveWindowsCmdInvocation(cmd, args)
      : { command: cmd, args };
    const spawnCmd = invocation.command;
    const spawnArgs = invocation.args;
    const spawnOptions = {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
      env: invocation.env ? { ...resolvedEnv, ...invocation.env } : resolvedEnv,
      shell: false,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments === true,
      detached: killTreeDetached
    };
    const child = typeof spawnProcess === 'function'
      ? spawnProcess({
        cmd: spawnCmd,
        args: [...spawnArgs],
        options: { ...spawnOptions },
        rawCmd: cmd,
        rawArgs: [...args],
        useShell
      })
      : spawn(spawnCmd, spawnArgs, spawnOptions);
    ownChildResource(child);
    if (!child || !isEventEmitterLike(child)) {
      cleanupInvalidSpawnCandidate(child, 'spawn_override_invalid_child');
      throw new Error('createLspClient spawnProcess override must return a ChildProcess-like object.');
    }
    if (!isWritableLike(child.stdin) || !isReadableLike(child.stdout)) {
      cleanupInvalidSpawnCandidate(child, 'spawn_override_invalid_stdio');
      throw new Error(
        'createLspClient spawnProcess override must provide stdin/stdout stream objects.'
      );
    }
    if (child.stderr != null && !isReadableLike(child.stderr)) {
      cleanupInvalidSpawnCandidate(child, 'spawn_override_invalid_stderr');
      throw new Error(
        'createLspClient spawnProcess override must provide a readable stderr stream when present.'
      );
    }
    proc = child;
    emitLifecycleEvent({
      kind: 'start',
      pid: Number.isFinite(Number(child?.pid)) ? Number(child.pid) : null,
      cmd,
      args
    });
    const unregisterChildProcess = registerChildProcessForCleanup(child, {
      killTree: true,
      detached: killTreeDetached
    });
    unregisterChildProcessByChild.set(child, unregisterChildProcess);
    trackedChildProcess = child;
    const childParser = createFramedJsonRpcParser({
      onMessage: handleMessage,
      onError: (err) => {
        log(`[lsp] parse error: ${err.message}`);
        emitLifecycleEvent({
          kind: 'protocol_parse_error',
          message: err?.message || String(err)
        });
        trackTreeCleanup(child, killChildProcessTree(child, {
          killTree: true,
          detached: killTreeDetached,
          graceMs: 0,
          awaitGrace: false
        })).catch(() => {});
      },
      maxBufferBytes,
      maxHeaderBytes,
      maxMessageBytes
    });
    parser = childParser;
    writer = getJsonRpcWriter(child.stdin);
    writerClosed = false;
    const markTransportClosed = (reason = 'transport_closed') => {
      if (proc !== child || childGen !== generation) return;
      if (!writerClosed) rejectPendingTransportClosed();
      writerClosed = true;
      if (child?.stdin) closeJsonRpcWriter(child.stdin);
      reapStaleChildProcess(child, reason);
    };
    const markWriterClosed = () => {
      markTransportClosed('writer_closed');
    };
    child.stdin?.on('close', markWriterClosed);
    child.stdin?.on('error', markWriterClosed);
    child.stdout?.on('data', (chunk) => {
      if (proc !== child || childGen !== generation) return;
      childParser?.push(chunk);
    });
    child.stdout?.on('close', () => {
      if (proc !== child || childGen !== generation) return;
      log('[lsp] reader closed');
      markTransportClosed('reader_closed');
    });
    child.stdout?.on('error', (err) => {
      if (proc !== child || childGen !== generation) return;
      log(`[lsp] stdout error: ${err?.message || err}`);
      markTransportClosed('reader_error');
    });
    child.stderr?.on('data', (chunk) => {
      if (proc !== child || childGen !== generation) return;
      const text = chunk.toString('utf8');
      if (!text) return;
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      for (const line of lines) {
        let nextLine = line;
        if (typeof stderrFilter === 'function') {
          try {
            const filtered = stderrFilter(nextLine);
            if (!filtered) continue;
            nextLine = String(filtered).trim();
            if (!nextLine) continue;
          } catch {}
        }
        emitStderrLine(nextLine);
        log(`[lsp] ${nextLine}`);
      }
    });
    child.on('error', (err) => {
      if (proc !== child || childGen !== generation) return;
      rejectPending(err);
      proc = null;
      childParser?.dispose();
      parser = null;
      writer = null;
      writerClosed = true;
      reapStaleChildProcess(child, 'spawn_error');
      if (child?.stdin) closeJsonRpcWriter(child.stdin);
      backoffMs = backoffMs ? Math.min(backoffMs * 2, 5000) : 250;
      nextStartAt = Date.now() + backoffMs;
      emitLifecycleEvent({
        kind: 'error',
        code: err?.code || null,
        message: err?.message || String(err),
        backoffMs
      });
    });
    child.on('exit', (code, signal) => {
      clearTrackedChild({ force: true, child });
      childParser?.dispose();
      if (child?.stdin) closeJsonRpcWriter(child.stdin);
      if (proc === child && childGen === generation) {
        rejectPending(new Error(`LSP exited (${code ?? 'null'}, ${signal ?? 'null'}).`));
        proc = null;
        parser = null;
        writer = null;
        writerClosed = true;
        backoffMs = backoffMs ? Math.min(backoffMs * 2, 5000) : 250;
        nextStartAt = Date.now() + backoffMs;
      }
      emitLifecycleEvent({
        kind: 'exit',
        pid: Number.isFinite(Number(child.pid)) ? Number(child.pid) : null,
        code: code ?? null,
        signal: signal ?? null,
        backoffMs
      });
    });
    return child;
  };

  const request = (method, params, {
    timeoutMs,
    startIfNeeded = true
  } = {}) => {
    try {
      if (startIfNeeded) {
        start();
      } else if (!isTransportRunning()) {
        const transportError = new Error(`LSP transport unavailable (${method}).`);
        transportError.code = 'ERR_LSP_TRANSPORT_CLOSED';
        return Promise.reject(transportError);
      }
    } catch (err) {
      return Promise.reject(err);
    }
    const id = nextId++;
    requestMetrics.requests += 1;
    const methodMetric = ensureMethodMetric(method);
    methodMetric.requests += 1;
    invalidateMetricsSnapshot();
    const resolvedTimeout = Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_REQUEST_TIMEOUT_MS;
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, method, timeout: null, startedAt };
      if (Number.isFinite(resolvedTimeout) && resolvedTimeout > 0) {
        entry.timeout = setTimeout(() => {
          if (pending.get(id) !== entry) return;
          pending.delete(id);
          requestMetrics.timedOut += 1;
          requestMetrics.failed += 1;
          methodMetric.timedOut += 1;
          methodMetric.failed += 1;
          recordRequestLatency(method, Date.now() - startedAt);
          invalidateMetricsSnapshot();
          try {
            notify('$/cancelRequest', { id }, { startIfNeeded: false });
          } catch {}
          const err = new Error(`LSP request timeout (${method}).`);
          err.code = 'ERR_LSP_REQUEST_TIMEOUT';
          reject(err);
        }, resolvedTimeout);
      }
      pending.set(id, entry);
      const onWriteFailure = (error, local = true) => failRequest(id, entry,
        addStorageFailureContext(error, { code: 'ERR_LSP_REQUEST_WRITE' }, undefined, { forceAggregate: true }),
        local ? 'localWriteFailed' : null);
      try {
        if (!send({ jsonrpc: '2.0', id, method, params }, onWriteFailure)) {
          failRequest(id, entry, new Error(`LSP writer unavailable (${method}).`));
        }
      } catch (error) { onWriteFailure(error); }
    });
  };

  const notify = (method, params, { startIfNeeded = true } = {}) => {
    try {
      if (startIfNeeded) {
        start();
      } else if (!isTransportRunning()) {
        return false;
      }
      return send({ jsonrpc: '2.0', method, params });
    } catch (err) {
      if (isClosedStreamWriteError(err)) {
        rejectPendingTransportClosed();
        writerClosed = true;
        return false;
      }
      log(`[lsp] notify failed: ${err?.message || err}`);
      return false;
    }
  };

  const initialize = async ({ rootUri, capabilities, initializationOptions, workspaceFolders, timeoutMs } = {}) => {
    const initialization = request('initialize', {
      processId: process.pid,
      rootUri: rootUri || null,
      capabilities: mergeInitializeCapabilities(capabilities),
      initializationOptions: initializationOptions || null,
      workspaceFolders: workspaceFolders || (rootUri ? [{ uri: rootUri, name: rootUri.split('/').pop() || 'workspace' }] : null)
    }, { timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 10000 });
    const current = proc;
    const currentGen = generation;
    const result = await initialization;
    if (proc !== current || generation !== currentGen || !isTransportRunning()) {
      const err = new Error('LSP transport closed.');
      err.code = 'ERR_LSP_TRANSPORT_CLOSED';
      throw err;
    }
    notify('initialized', {}, { startIfNeeded: false });
    backoffMs = 0;
    nextStartAt = 0;
    return result;
  };

  const shutdownAndExit = async () => {
    if (!proc) return;
    const current = proc;
    const currentGen = generation;
    if (isTransportRunning()) {
      try {
        await request('shutdown', null, { timeoutMs: 5000, startIfNeeded: false });
      } catch {}
      if (proc !== current || generation !== currentGen) return;
      if (!writerClosed) {
        notify('exit', null, { startIfNeeded: false });
      }
    }
    await waitForChildExit(current);
    if (proc === current && generation === currentGen && isChildRunning(current)) {
      await Promise.resolve(kill());
    }
  };

  const kill = () => {
    if (!proc) return Promise.all([...pendingTerminations]);
    const current = proc;
    // Subscribe before signalling; signal delivery does not reap a child handle.
    const exited = waitForChildExit(current);
    const terminatePromise = Promise.all([trackTreeCleanup(current, killChildProcessTree(current, {
      killTree: true,
      detached: killTreeDetached,
      graceMs: 0,
      awaitGrace: true
    })).catch(() => null), exited]).then(([outcome, exitObserved]) => {
      if (exitObserved) clearTrackedChild({ force: true, child: current });
      const result = { ...outcome, terminated: exitObserved, exitObserved };
      if (exitObserved && !outcome?.fallbackAttempted) return result;
      emitLifecycleEvent({
        kind: 'kill_diagnostics',
        reason: 'explicit_kill',
        pid: Number.isFinite(Number(current?.pid)) ? Number(current.pid) : null,
        terminated: exitObserved,
        forced: outcome?.forced === true,
        fallbackAttempted: outcome?.fallbackAttempted === true,
        fallbackTerminated: Number(outcome?.fallbackTerminated || 0)
      });
      return result;
    }).finally(() => {
      pendingTerminations.delete(terminatePromise);
      notifyResourceSettlement();
    });
    pendingTerminations.add(terminatePromise);
    rejectPendingTransportClosed();
    if (current.stdin) closeJsonRpcWriter(current.stdin);
    try {
      current.stdout?.destroy();
    } catch {}
    try {
      current.stderr?.destroy();
    } catch {}
    parser?.dispose();
    try {
      current.unref?.();
    } catch {}
    setTimeout(() => {
      if (isChildRunning(current)) {
        trackTreeCleanup(current, killChildProcessTree(current, {
          killTree: true,
          detached: killTreeDetached,
          graceMs: 0,
          awaitGrace: false
        })).then(() => {
          clearTrackedChildIfTerminated(current);
        }).catch(() => {});
      }
    }, 200).unref?.();
    proc = null;
    writer = null;
    writerClosed = true;
    backoffMs = 0;
    nextStartAt = 0;
    emitLifecycleEvent({
      kind: 'kill',
      pid: Number.isFinite(Number(current?.pid)) ? Number(current.pid) : null
    });
    return Promise.all([...pendingTerminations]).then(() => terminatePromise);
  };

  const killSync = () => {
    if (!proc) return;
    const current = proc;
    try {
      killChildProcessTreeSync(current, {
        killTree: true,
        detached: killTreeDetached
      });
      failedTreeCleanup.delete(current);
    } catch { failedTreeCleanup.add(current); }
    rejectPendingTransportClosed();
    if (current.stdin) closeJsonRpcWriter(current.stdin);
    try {
      current.stdout?.destroy();
    } catch {}
    try {
      current.stderr?.destroy();
    } catch {}
    parser?.dispose();
    try {
      current.unref?.();
    } catch {}
    proc = null;
    clearTrackedChildIfTerminated(current);
    writer = null;
    writerClosed = true;
    backoffMs = 0;
    nextStartAt = 0;
    emitLifecycleEvent({
      kind: 'kill_sync',
      pid: Number.isFinite(Number(current?.pid)) ? Number(current.pid) : null
    });
  };

  const getTerminationEvidence = () => ({ exitObserved: !trackedChildProcess && pendingTerminations.size === 0,
    closeObserved: childResources.size === 0 && !unknownSpawnResource,
    settled: !trackedChildProcess && childResources.size === 0 && !unknownSpawnResource
      && pendingTerminations.size === 0 && pendingTreeCleanup.size === 0 && failedTreeCleanup.size === 0,
    pending: pendingTerminations.size + pendingTreeCleanup.size, pendingChildren: childResources.size,
    treeCleanupFailed: failedTreeCleanup.size > 0, unknownSpawnResource,
    pid: trackedChildProcess?.pid ?? null });

  function notifyResourceSettlement() {
    if (getTerminationEvidence().settled !== true) return;
    for (const observer of resourceSettlementObservers) {
      try { observer(); } catch (error) { log(`[lsp] resource-settlement observer failed: ${error?.message || error}`); }
    }
  }

  const waitForResourceSettlement = async ({ timeoutMs = 2500 } = {}) => {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 8000) throw new TypeError('Invalid LSP resource-settlement wait.');
    let timer;
    try {
      await Promise.race([
        Promise.allSettled([...resourceClosures.values(), ...pendingTerminations, ...pendingTreeCleanup]),
        new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); })
      ]);
    } finally { clearTimeout(timer); }
    return getTerminationEvidence();
  };

  return {
    start,
    initialize,
    notify,
    request,
    getGeneration: () => generation,
    isTransportRunning,
    getMetrics: () => {
      if (!metricsSnapshotDirty && cachedMetricsSnapshot) {
        return cachedMetricsSnapshot;
      }
      cachedMetricsSnapshot = {
        requests: requestMetrics.requests,
        succeeded: requestMetrics.succeeded,
        failed: requestMetrics.failed,
        timedOut: requestMetrics.timedOut,
        protocolFailed: requestMetrics.protocolFailed,
        localWriteFailed: requestMetrics.localWriteFailed,
        latencyMs: summarizeLatencies(
          requestMetrics.latencySamplesMs,
          requestMetrics.latencyTotalMs,
          requestMetrics.latencyMaxMs
        ),
        byMethod: Object.fromEntries(
          Object.entries(requestMetrics.byMethod).map(([method, stats]) => [
            method,
            {
              requests: Number(stats?.requests || 0),
              succeeded: Number(stats?.succeeded || 0),
              failed: Number(stats?.failed || 0),
              timedOut: Number(stats?.timedOut || 0),
              protocolFailed: Number(stats?.protocolFailed || 0),
              localWriteFailed: Number(stats?.localWriteFailed || 0),
              latencyMs: summarizeLatencies(
                stats?.latencySamplesMs,
                stats?.latencyTotalMs,
                stats?.latencyMaxMs
              )
            }
          ])
        )
      };
      metricsSnapshotDirty = false;
      return cachedMetricsSnapshot;
    },
    shutdownAndExit,
    getTerminationEvidence,
    waitForResourceSettlement,
    onResourcesSettled(observer) {
      if (typeof observer !== 'function') throw new TypeError('LSP resource observer must be a function.');
      resourceSettlementObservers.add(observer);
      return () => resourceSettlementObservers.delete(observer);
    },
    kill,
    killSync
  };
}
