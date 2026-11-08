import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createOwnedStdioClient } from './stdio-client.js';
import { settleOwnedActions, combineOwnedErrors } from './settle-owned.js';

export const SEMANTIC_PAGED_COMMANDS = new Set(['semantic.detail', 'semantic.trace', 'semantic.find', 'semantic.explain']);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const TTL_MS = 5 * 60 * 1000;

/** Cursors stay private to a single canonical runner process. The UI receives a
 * session capability bound to exact scope, request identity, command and TTL.
 */
export const createTuiSemanticPages = ({ toolRoot, requireScope, now = Date.now,
  createClient = createOwnedStdioClient } = {}) => {
  const sessions = new Map();
  const closing = new Map();
  const close = entry => {
    if (entry.closed) return Promise.resolve();
    if (entry.closing) return entry.closing;
    if (sessions.get(entry.id) === entry) sessions.delete(entry.id);
    clearTimeout(entry.timer);
    closing.set(entry.id, entry);
    entry.closing = Promise.resolve().then(() => entry.client.dispose()).then(result => {
      if (result?.closed !== true || result.pending !== false) {
        throw Object.assign(new Error('Semantic disposal returned no confirmed closure receipt.'),
          { code: 'ERR_TUI_SEMANTIC_CLOSE', cacheOwnershipPending: true });
      }
      entry.closed = true;
      closing.delete(entry.id);
    }).catch(error => {
      entry.closeErrorCode = String(error?.code || 'ERR_TUI_SEMANTIC_CLOSE');
      throw error;
    }).finally(() => { entry.closing = null; });
    entry.closing.catch(() => {});
    return entry.closing;
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
      if (sessions.get(entry.id) !== entry || entry.closing || entry.closed) {
        fail('ERR_TUI_SEMANTIC_EXPIRED', 'The continuation closed before its page could be committed.');
      }
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
    } catch (error) {
      try { await close(entry); }
      catch (cleanup) { throw cleanup === error ? error : combineOwnedErrors(error, [cleanup]); }
      throw error;
    }
    finally { entry.busy = false; }
  };
  const open = async ({ scope, commandId, request, requestSha256 }, { signal, env, onSpawn }) => {
    requireScope(scope.id);
    if (!SEMANTIC_PAGED_COMMANDS.has(commandId) || request.cursor) fail('ERR_TUI_SEMANTIC_REQUEST', 'Open a fresh supported semantic request without a cursor.');
    if (sessions.size + closing.size >= 4) fail('ERR_TUI_SEMANTIC_ADMISSION', 'Close an existing continuation before opening another (maximum four, including pending closure).');
    const client = createClient({ command: process.execPath, args: [path.join(toolRoot, 'tools/tui/operator/semantic-worker.js'), commandId],
      cwd: scope.configRoot, env, onSpawn, maxPending: 1 });
    const entry = { id: randomUUID(), scopeId: scope.id, commandId, requestSha256,
      createdAt: now(), pages: 0, busy: false, client, timer: null };
    sessions.set(entry.id, entry);
    entry.timer = setTimeout(() => { close(entry).catch(() => {}); }, TTL_MS);
    entry.timer.unref?.();
    client.completion.then(() => close(entry), () => close(entry)).catch(() => {});
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
  const status = scopeId => [...sessions.values(), ...closing.values()].filter(entry => entry.scopeId === scopeId)
    .map(entry => ({ id: entry.id, commandId: entry.commandId, pages: entry.pages,
      expiresAt: new Date(entry.createdAt + TTL_MS).toISOString(), ...entry.client.status(),
      closurePending: closing.get(entry.id) === entry, closeErrorCode: entry.closeErrorCode || null }));
  return { open, next, discard, status, dispose: async () => {
    const owned = [...sessions.values(), ...closing.values()];
    await settleOwnedActions(Object.fromEntries(owned.map(entry => [entry.id, () => close(entry)])));
  } };
};
