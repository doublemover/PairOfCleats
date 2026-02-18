import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { closeJsonRpcWriter, createFramedJsonRpcParser, getJsonRpcWriter } from '../../../shared/jsonrpc.js';

/**
 * Convert a local path to a file:// URI.
 * @param {string} absPath
 * @returns {string}
 */
export function pathToFileUri(absPath) {
  return pathToFileURL(path.resolve(absPath)).href;
}

/**
 * Map file extensions to LSP language identifiers.
 * @param {string} ext
 * @returns {string}
 */
export function languageIdForFileExt(ext) {
  const normalized = ext.toLowerCase();
  const map = {
    '.ts': 'typescript',
    '.tsx': 'typescriptreact',
    '.mts': 'typescript',
    '.cts': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascriptreact',
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
    '.pyi': 'python'
  };
  return map[normalized] || 'plaintext';
}

const quoteWindowsCmdArg = (value) => {
  const text = String(value ?? '');
  if (!text) return '""';
  if (!/\s|"/u.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
};

const buildWindowsShellCommand = (cmd, args) => (
  [cmd, ...(Array.isArray(args) ? args : [])].map(quoteWindowsCmdArg).join(' ')
);

/**
 * Create a minimal JSON-RPC client for LSP servers.
 * @param {{cmd:string,args?:string[],cwd?:string,env?:object,log?:(msg:string)=>void,onNotification?:(msg:object)=>void,onRequest?:(msg:object)=>Promise<any>}} options
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
    stderrFilter,
    maxBufferBytes,
    maxHeaderBytes,
    maxMessageBytes
  } = options || {};
  if (!cmd) throw new Error('createLspClient requires a command.');
  const useShell = typeof shell === 'boolean'
    ? shell
    : (process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd));

  let proc = null;
  let parser = null;
  let writer = null;
  let writerClosed = false;
  let nextId = 1;
  const pending = new Map();
  let generation = 0;
  let backoffMs = 0;
  let nextStartAt = 0;
  // Ensure every LSP request is bounded unless explicitly disabled.
  const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
  const CLOSED_TRANSPORT_WRITE_ERROR_CODES = new Set([
    'ERR_STREAM_DESTROYED',
    'EPIPE',
    'ECONNRESET',
    'ERR_SOCKET_CLOSED',
    'EOF'
  ]);
  const isClosedTransportWriteError = (err) => {
    const code = String(err?.code || '').toUpperCase();
    if (code && CLOSED_TRANSPORT_WRITE_ERROR_CODES.has(code)) return true;
    const message = [
      String(err?.message || ''),
      String(err?.cause?.message || ''),
      String(err || '')
    ].join(' ');
    return /\bEPIPE\b/i.test(message) || /stream (?:is )?closed/i.test(message);
  };

  const rejectPending = (err) => {
    for (const entry of pending.values()) {
      if (entry.timeout) clearTimeout(entry.timeout);
      entry.reject(err);
    }
    pending.clear();
  };

  const rejectPendingTransportClosed = () => {
    const err = new Error('LSP transport closed.');
    err.code = 'ERR_LSP_TRANSPORT_CLOSED';
    rejectPending(err);
  };

  const send = (payload) => {
    if (!writer || writerClosed) return false;
    const pendingWrite = writer.write(payload);
    if (pendingWrite && typeof pendingWrite.catch === 'function') {
      pendingWrite.catch((err) => {
        if (isClosedTransportWriteError(err)) {
          rejectPendingTransportClosed();
          writerClosed = true;
          return;
        }
        log(`[lsp] write error: ${err?.message || err}`);
      });
    }
    return true;
  };

  const handleResponse = (message) => {
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (entry.timeout) clearTimeout(entry.timeout);
    if (message.error) {
      const err = new Error(message.error.message || 'LSP request failed.');
      err.code = message.error.code;
      entry.reject(err);
      return;
    }
    entry.resolve(message.result);
  };

  const handleRequest = async (message) => {
    if (typeof onRequest === 'function') {
      try {
        const result = await onRequest(message);
        send({ jsonrpc: '2.0', id: message.id, result: result ?? null });
      } catch (err) {
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
    if (!message || typeof message !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(message, 'id')) {
      if (message.method) {
        void handleRequest(message);
        return;
      }
      handleResponse(message);
      return;
    }
    if (message.method && typeof onNotification === 'function') {
      onNotification(message);
    }
  };

  const start = () => {
    if (proc) {
      if (proc.killed || proc.exitCode !== null || writerClosed) {
        if (proc.stdin) closeJsonRpcWriter(proc.stdin);
        parser?.dispose();
        proc = null;
        writer = null;
        writerClosed = true;
      } else {
        return proc;
      }
    }
    const now = Date.now();
    if (nextStartAt && now < nextStartAt) {
      throw new Error(`LSP start backoff active (${nextStartAt - now}ms remaining).`);
    }
    generation += 1;
    const childGen = generation;
    const spawnCmd = useShell ? buildWindowsShellCommand(cmd, args) : cmd;
    const spawnArgs = useShell ? [] : args;
    const spawnOptions = { stdio: ['pipe', 'pipe', 'pipe'], cwd, env, shell: useShell };
    const child = useShell
      ? spawn(spawnCmd, spawnOptions)
      : spawn(spawnCmd, spawnArgs, spawnOptions);
    proc = child;
    const childParser = createFramedJsonRpcParser({
      onMessage: handleMessage,
      onError: (err) => {
        log(`[lsp] parse error: ${err.message}`);
        child?.kill();
      },
      maxBufferBytes,
      maxHeaderBytes,
      maxMessageBytes
    });
    parser = childParser;
    writer = getJsonRpcWriter(child.stdin);
    writerClosed = false;
    const markWriterClosed = () => {
      if (proc !== child || childGen !== generation) return;
      if (!writerClosed) rejectPendingTransportClosed();
      writerClosed = true;
      if (child?.stdin) closeJsonRpcWriter(child.stdin);
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
      rejectPendingTransportClosed();
    });
    child.stdout?.on('error', (err) => {
      if (proc !== child || childGen !== generation) return;
      log(`[lsp] stdout error: ${err?.message || err}`);
    });
    child.stderr.on('data', (chunk) => {
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
      if (child?.stdin) closeJsonRpcWriter(child.stdin);
      backoffMs = backoffMs ? Math.min(backoffMs * 2, 5000) : 250;
      nextStartAt = Date.now() + backoffMs;
    });
    child.on('exit', (code, signal) => {
      if (proc !== child || childGen !== generation) return;
      rejectPending(new Error(`LSP exited (${code ?? 'null'}, ${signal ?? 'null'}).`));
      proc = null;
      childParser?.dispose();
      parser = null;
      writer = null;
      writerClosed = true;
      if (child?.stdin) closeJsonRpcWriter(child.stdin);
      backoffMs = backoffMs ? Math.min(backoffMs * 2, 5000) : 250;
      nextStartAt = Date.now() + backoffMs;
    });
    return child;
  };

  const request = (method, params, { timeoutMs } = {}) => {
    try {
      start();
    } catch (err) {
      return Promise.reject(err);
    }
    const id = nextId++;
    const resolvedTimeout = Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_REQUEST_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, method, timeout: null };
      if (Number.isFinite(resolvedTimeout) && resolvedTimeout > 0) {
        entry.timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`LSP request timeout (${method}).`));
        }, resolvedTimeout);
      }
      pending.set(id, entry);
      if (!send({ jsonrpc: '2.0', id, method, params })) {
        pending.delete(id);
        if (entry.timeout) clearTimeout(entry.timeout);
        entry.reject(new Error(`LSP writer unavailable (${method}).`));
      }
    });
  };

  const notify = (method, params) => {
    try {
      start();
      send({ jsonrpc: '2.0', method, params });
    } catch (err) {
      if (isClosedTransportWriteError(err)) {
        rejectPendingTransportClosed();
        writerClosed = true;
        return;
      }
      log(`[lsp] notify failed: ${err?.message || err}`);
    }
  };

  const initialize = async ({ rootUri, capabilities, initializationOptions, workspaceFolders, timeoutMs } = {}) => {
    const result = await request('initialize', {
      processId: process.pid,
      rootUri: rootUri || null,
      capabilities: capabilities || {},
      initializationOptions: initializationOptions || null,
      workspaceFolders: workspaceFolders || (rootUri ? [{ uri: rootUri, name: rootUri.split('/').pop() || 'workspace' }] : null)
    }, { timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 10000 });
    notify('initialized', {});
    backoffMs = 0;
    nextStartAt = 0;
    return result;
  };

  const shutdownAndExit = async () => {
    if (!proc) return;
    try {
      await request('shutdown', null, { timeoutMs: 5000 });
    } catch {}
    if (!writerClosed) {
      notify('exit', null);
    }
    const current = proc;
    const currentGen = generation;
    setTimeout(() => {
      if (proc === current && generation === currentGen) kill();
    }, 2500).unref?.();
  };

  const kill = () => {
    if (!proc) return;
    const current = proc;
    if (current.stdin) closeJsonRpcWriter(current.stdin);
    parser?.dispose();
    try {
      current.kill();
    } catch {}
    proc = null;
    writer = null;
    writerClosed = true;
    backoffMs = 0;
    nextStartAt = 0;
  };

  return {
    start,
    initialize,
    notify,
    request,
    shutdownAndExit,
    kill
  };
}
