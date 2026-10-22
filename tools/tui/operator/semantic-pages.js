import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createOwnedStdioClient } from './stdio-client.js';

export const SEMANTIC_PAGED_COMMANDS = new Set(['semantic.detail', 'semantic.trace', 'semantic.find', 'semantic.explain']);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const TTL_MS = 5 * 60 * 1000;

/** Cursors stay private to a single canonical runner process. The UI receives a
 * session capability bound to exact scope, request identity, command and TTL.
 */
export const createTuiSemanticPages = ({ toolRoot, requireScope, now = Date.now,
  createClient = createOwnedStdioClient } = {}) => {
  const sessions = new Map();
  const close = async entry => {
    if (sessions.get(entry.id) === entry) sessions.delete(entry.id);
    clearTimeout(entry.timer);
    await entry.client.dispose();
  };
  const takePage = async (entry, method, params, signal) => {
    requireScope(entry.scopeId);
    if (entry.busy) fail('ERR_TUI_SEMANTIC_BUSY', 'This continuation is already running.');
    if (now() - entry.createdAt >= TTL_MS || entry.pages >= 128) {
      await close(entry); fail('ERR_TUI_SEMANTIC_EXPIRED', 'The native continuation expired. Run a fresh query.');
    }
    entry.busy = true;
    try {
      const data = await entry.client.request(method, params, { signal, timeoutMs: 13000 });
      requireScope(entry.scopeId);
      if (!data || typeof data.hasMore !== 'boolean' || !data.page || typeof data.page !== 'object') {
        fail('ERR_TUI_SEMANTIC_PAGE', 'Invalid semantic page envelope.');
      }
      entry.pages += 1;
      const result = { ...data.page, nativePageCommitted: true,
        nativeContinuation: data.hasMore ? { id: entry.id, scopeId: entry.scopeId,
        commandId: entry.commandId, requestSha256: entry.requestSha256, pages: entry.pages,
        expiresAt: new Date(entry.createdAt + TTL_MS).toISOString() } : null };
      if (!data.hasMore) await close(entry);
      return result;
    } catch (error) { await close(entry); throw error; }
    finally { entry.busy = false; }
  };
  const open = async ({ scope, commandId, request, requestSha256 }, { signal, env, onSpawn }) => {
    requireScope(scope.id);
    if (!SEMANTIC_PAGED_COMMANDS.has(commandId) || request.cursor) fail('ERR_TUI_SEMANTIC_REQUEST', 'Open a fresh supported semantic request without a cursor.');
    if (sessions.size >= 4) fail('ERR_TUI_SEMANTIC_ADMISSION', 'Close an existing continuation before opening another (maximum four).');
    const client = createClient({ command: process.execPath, args: [path.join(toolRoot, 'tools/tui/operator/semantic-worker.js'), commandId],
      cwd: scope.configRoot, env, onSpawn, maxPending: 1 });
    const entry = { id: randomUUID(), scopeId: scope.id, commandId, requestSha256,
      createdAt: now(), pages: 0, busy: false, client, timer: null };
    sessions.set(entry.id, entry);
    entry.timer = setTimeout(() => { close(entry).catch(() => {}); }, TTL_MS);
    entry.timer.unref?.();
    client.completion.then(() => { close(entry).catch(() => {}); });
    return takePage(entry, 'page.open', request, signal);
  };
  const next = async (request, { signal } = {}) => {
    requireScope(request.scopeId);
    const entry = sessions.get(request.continuationId);
    if (!entry || entry.scopeId !== request.scopeId) fail('ERR_TUI_SEMANTIC_EXPIRED', 'The continuation is no longer owned by this scope.');
    return takePage(entry, 'page.next', {}, signal);
  };
  const discard = async request => {
    requireScope(request.scopeId);
    const entry = sessions.get(request.continuationId);
    if (!entry || entry.scopeId !== request.scopeId) fail('ERR_TUI_SEMANTIC_EXPIRED', 'The continuation is no longer owned by this scope.');
    await close(entry); return { discarded: true };
  };
  const status = scopeId => [...sessions.values()].filter(entry => entry.scopeId === scopeId)
    .map(entry => ({ id: entry.id, commandId: entry.commandId, pages: entry.pages,
      expiresAt: new Date(entry.createdAt + TTL_MS).toISOString(), ...entry.client.status() }));
  return { open, next, discard, status, dispose: async () => { await Promise.all([...sessions.values()].map(close)); } };
};
