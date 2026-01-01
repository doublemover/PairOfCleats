import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createFramedJsonRpcParser, writeFramedJsonRpc } from '../../shared/jsonrpc.js';

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
    '.swift': 'swift'
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
    onRequest
  } = options || {};
  if (!cmd) throw new Error('createLspClient requires a command.');

  let proc = null;
  let nextId = 1;
  const pending = new Map();

  const send = (payload) => {
    if (!proc?.stdin) return;
    writeFramedJsonRpc(proc.stdin, payload);
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
    proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], cwd, env, shell });
    const parser = createFramedJsonRpcParser({
      onMessage: handleMessage,
      onError: (err) => log(`[lsp] parse error: ${err.message}`)
    });
    proc.stdout.on('data', (chunk) => parser.push(chunk));
    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8').trim();
      if (text) log(`[lsp] ${text}`);
    });
    proc.on('error', (err) => {
      for (const entry of pending.values()) {
        if (entry.timeout) clearTimeout(entry.timeout);
        entry.reject(err);
      }
      pending.clear();
      proc = null;
    });
    proc.on('exit', (code, signal) => {
      for (const entry of pending.values()) {
        if (entry.timeout) clearTimeout(entry.timeout);
        entry.reject(new Error(`LSP exited (${code ?? 'null'}, ${signal ?? 'null'}).`));
      }
      pending.clear();
      proc = null;
    });
    return proc;
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
      send({ jsonrpc: '2.0', id, method, params });
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
    notify('exit', null);
  };

  const kill = () => {
    if (!proc) return;
    proc.kill();
    proc = null;
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
