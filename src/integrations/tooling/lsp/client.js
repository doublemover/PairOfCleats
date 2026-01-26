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
    shell = false,
    log = () => {},
    onNotification,
    onRequest,
    maxBufferBytes,
    maxHeaderBytes,
    maxMessageBytes
  } = options || {};
  if (!cmd) throw new Error('createLspClient requires a command.');

  let proc = null;
  let parser = null;
  let writer = null;
  let writerClosed = false;
  let nextId = 1;
  const pending = new Map();

  const send = (payload) => {
    if (!writer || writerClosed) return false;
    const pendingWrite = writer.write(payload);
    if (pendingWrite && typeof pendingWrite.catch === 'function') {
      pendingWrite.catch((err) => {
        if (err?.code === 'ERR_STREAM_DESTROYED') {
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
    if (proc) return proc;
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], cwd, env, shell });
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
      if (proc !== child) return;
      writerClosed = true;
      if (child?.stdin) closeJsonRpcWriter(child.stdin);
    };
    child.stdin?.on('close', markWriterClosed);
    child.stdin?.on('error', markWriterClosed);
    child.stdout?.on('data', (chunk) => {
      if (proc !== child) return;
      childParser?.push(chunk);
    });
    child.stdout?.on('close', () => {
      if (proc !== child) return;
      log('[lsp] reader closed');
    });
    child.stdout?.on('error', (err) => {
      if (proc !== child) return;
      log(`[lsp] stdout error: ${err?.message || err}`);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8').trim();
      if (text) log(`[lsp] ${text}`);
    });
    child.on('error', (err) => {
      if (proc !== child) return;
      for (const entry of pending.values()) {
        if (entry.timeout) clearTimeout(entry.timeout);
        entry.reject(err);
      }
      pending.clear();
      proc = null;
      childParser?.dispose();
      parser = null;
      writer = null;
      writerClosed = true;
      if (child?.stdin) closeJsonRpcWriter(child.stdin);
    });
    child.on('exit', (code, signal) => {
      if (proc !== child) return;
      for (const entry of pending.values()) {
        if (entry.timeout) clearTimeout(entry.timeout);
        entry.reject(new Error(`LSP exited (${code ?? 'null'}, ${signal ?? 'null'}).`));
      }
      pending.clear();
      proc = null;
      childParser?.dispose();
      parser = null;
      writer = null;
      writerClosed = true;
      if (child?.stdin) closeJsonRpcWriter(child.stdin);
    });
    return child;
  };

  const request = (method, params, { timeoutMs } = {}) => {
    start();
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, method, timeout: null };
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        entry.timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`LSP request timeout (${method}).`));
        }, timeoutMs);
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
    start();
    send({ jsonrpc: '2.0', method, params });
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
  };

  const kill = () => {
    if (!proc) return;
    if (proc.stdin) closeJsonRpcWriter(proc.stdin);
    parser?.dispose();
    proc.kill();
    proc = null;
    writerClosed = true;
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
