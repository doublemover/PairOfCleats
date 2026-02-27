import { createLspClient } from '../../lsp/client.js';
import { createToolingGuard, createToolingLifecycleHealth } from '../shared.js';
import { coercePositiveInt } from '../../../../shared/number-coerce.js';
import { stableStringify } from '../../../../shared/stable-json.js';

const DEFAULT_IDLE_TIMEOUT_MS = 1_500;
const DEFAULT_MAX_LIFETIME_MS = 10 * 60_000;
const DEFAULT_CLEANUP_INTERVAL_MS = 500;

const sessions = new Map();
let cleanupTimer = null;
let exitCleanupInstalled = false;

const toPositiveInt = (value, fallback, min = 1) => {
  const parsed = coercePositiveInt(value);
  if (parsed == null) return fallback;
  return Math.max(min, parsed);
};

const toNonNegativeInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
};

const normalizeArgs = (value) => (
  Array.isArray(value) ? value.map((entry) => String(entry)) : []
);

const buildSessionKey = ({
  repoRoot,
  providerId,
  workspaceKey,
  cmd,
  args,
  initializationOptions,
  cwd,
  shell,
  timeoutMs,
  retries,
  breakerThreshold,
  lifecycleRestartWindowMs,
  lifecycleMaxRestartsPerWindow,
  lifecycleFdPressureBackoffMs,
  sessionIdleTimeoutMs,
  sessionMaxLifetimeMs
}) => {
  const payload = {
    repoRoot: String(repoRoot || ''),
    providerId: String(providerId || ''),
    workspaceKey: String(workspaceKey || ''),
    cmd: String(cmd || ''),
    args: normalizeArgs(args),
    initializationOptions: initializationOptions ?? null,
    cwd: String(cwd || ''),
    shell: shell === true,
    timeoutMs: toPositiveInt(timeoutMs, 15000, 1),
    retries: toNonNegativeInt(retries, 2),
    breakerThreshold: toPositiveInt(breakerThreshold, 3, 1),
    lifecycleRestartWindowMs: toPositiveInt(lifecycleRestartWindowMs, 60000, 1000),
    lifecycleMaxRestartsPerWindow: toPositiveInt(lifecycleMaxRestartsPerWindow, 6, 2),
    lifecycleFdPressureBackoffMs: toPositiveInt(lifecycleFdPressureBackoffMs, 1500, 50),
    sessionIdleTimeoutMs: toPositiveInt(sessionIdleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS, 1000),
    sessionMaxLifetimeMs: toPositiveInt(sessionMaxLifetimeMs, DEFAULT_MAX_LIFETIME_MS, 1000)
  };
  return stableStringify(payload);
};

const createPendingBarrier = () => {
  let resolve = null;
  let reject = null;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
};

const killSessionClient = (session) => {
  if (!session || typeof session !== 'object') return;
  try {
    if (session.client && typeof session.client.kill === 'function') {
      session.client.kill();
    }
  } catch {}
};

const disposeSessionClient = async (session) => {
  if (!session || typeof session !== 'object') return;
  session.disposed = true;
  try {
    if (session.client && typeof session.client.shutdownAndExit === 'function') {
      await session.client.shutdownAndExit();
    }
  } catch {}
  killSessionClient(session);
};

const shouldExpireForLifetime = (session, now = Date.now()) => (
  Number.isFinite(session?.maxLifetimeMs)
  && session.maxLifetimeMs > 0
  && ((now - Number(session?.createdAt || now)) >= session.maxLifetimeMs)
);

const createSession = (options) => {
  const key = buildSessionKey(options);
  const now = Date.now();
  const lifecycleHealth = createToolingLifecycleHealth({
    name: options.lifecycleName || options.cmd,
    restartWindowMs: options.lifecycleRestartWindowMs,
    maxRestartsPerWindow: options.lifecycleMaxRestartsPerWindow,
    fdPressureBackoffMs: options.lifecycleFdPressureBackoffMs,
    log: options.log
  });
  const handlers = {
    onNotification: typeof options.onNotification === 'function' ? options.onNotification : null,
    onRequest: typeof options.onRequest === 'function' ? options.onRequest : null,
    stderrFilter: typeof options.stderrFilter === 'function' ? options.stderrFilter : null,
    onStderrLine: typeof options.onStderrLine === 'function' ? options.onStderrLine : null
  };
  const client = createLspClient({
    cmd: options.cmd,
    args: options.args,
    cwd: options.cwd,
    env: options.env,
    shell: options.shell,
    log: options.log,
    stderrFilter: (line) => {
      const filter = handlers.stderrFilter;
      if (typeof filter !== 'function') return line;
      try {
        return filter(line);
      } catch {
        return line;
      }
    },
    onNotification: (message) => {
      if (typeof handlers.onNotification !== 'function') return;
      handlers.onNotification(message);
    },
    onRequest: async (message) => {
      if (typeof handlers.onRequest !== 'function') return null;
      return handlers.onRequest(message);
    },
    onLifecycleEvent: lifecycleHealth.onLifecycleEvent,
    onStderrLine: (line) => {
      lifecycleHealth.noteStderrLine(line);
      if (typeof handlers.onStderrLine === 'function') {
        handlers.onStderrLine(line);
      }
    }
  });
  const guard = createToolingGuard({
    name: options.lifecycleName || options.cmd,
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    breakerThreshold: options.breakerThreshold,
    log: options.log
  });
  return {
    key,
    client,
    guard,
    lifecycleHealth,
    queue: Promise.resolve(),
    createdAt: now,
    lastUsedAt: now,
    activeCount: 0,
    reuseCount: 0,
    recycleCount: 0,
    idleTimeoutMs: toPositiveInt(options.sessionIdleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS, 1000),
    maxLifetimeMs: toPositiveInt(options.sessionMaxLifetimeMs, DEFAULT_MAX_LIFETIME_MS, 1000),
    lifecycleName: options.lifecycleName || options.cmd,
    handlers,
    options
  };
};

const clearCleanupTimer = () => {
  if (!cleanupTimer) return;
  clearInterval(cleanupTimer);
  cleanupTimer = null;
};

const killAllSessionsNow = () => {
  const live = Array.from(sessions.values());
  sessions.clear();
  clearCleanupTimer();
  for (const session of live) {
    killSessionClient(session);
  }
};

const runCleanupPass = async () => {
  if (!sessions.size) {
    clearCleanupTimer();
    return;
  }
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (!session || session.activeCount > 0) continue;
    const idleMs = now - Number(session.lastUsedAt || now);
    const idleTimeoutMs = toPositiveInt(session.idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS, 1000);
    if (idleMs < idleTimeoutMs) continue;
    sessions.delete(key);
    await disposeSessionClient(session);
  }
};

const ensureCleanupTimer = () => {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    void runCleanupPass();
  }, DEFAULT_CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();
  if (!exitCleanupInstalled) {
    exitCleanupInstalled = true;
    process.once('exit', () => {
      killAllSessionsNow();
    });
  }
};

const getOrCreateSession = (options) => {
  const key = buildSessionKey(options);
  const now = Date.now();
  const existing = sessions.get(key);
  if (existing && !existing.disposed) {
    const idleTimeoutMs = toPositiveInt(existing.idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS, 1000);
    const idleExpired = (now - Number(existing.lastUsedAt || now)) >= idleTimeoutMs;
    if ((shouldExpireForLifetime(existing, now) || idleExpired) && existing.activeCount === 0) {
      sessions.delete(key);
      killSessionClient(existing);
      void disposeSessionClient(existing);
    } else {
      existing.lastUsedAt = now;
      return { session: existing, reused: true };
    }
  }
  const next = createSession(options);
  sessions.set(key, next);
  ensureCleanupTimer();
  return { session: next, reused: false };
};

/**
 * Run work against a pooled LSP session using an exclusive lease.
 * Sessions are keyed by repo/provider/workspace and command profile.
 *
 * @template T
 * @param {{
 *   enabled?:boolean,
 *   repoRoot:string,
 *   providerId:string,
 *   workspaceKey?:string|null,
 *   cmd:string,
 *   args?:string[],
 *   cwd?:string,
 *   env?:object,
 *   shell?:boolean,
 *   log?:(line:string)=>void,
 *   stderrFilter?:((line:string)=>string|false|undefined|null)|null,
 *   onNotification?:(msg:object)=>void,
 *   onRequest?:(msg:object)=>Promise<any>,
 *   timeoutMs:number,
 *   retries:number,
 *   breakerThreshold:number,
 *   lifecycleName?:string,
 *   lifecycleRestartWindowMs?:number|null,
 *   lifecycleMaxRestartsPerWindow?:number|null,
 *   lifecycleFdPressureBackoffMs?:number|null,
 *   sessionIdleTimeoutMs?:number|null,
 *   sessionMaxLifetimeMs?:number|null,
 *   initializationOptions?:object|null
 * }} options
 * @param {(lease:{
 *   client:ReturnType<typeof createLspClient>,
 *   guard:ReturnType<typeof createToolingGuard>,
 *   lifecycleHealth:ReturnType<typeof createToolingLifecycleHealth>,
 *   pooled:boolean,
 *   sessionKey:string|null,
 *   reused:boolean,
 *   recycleCount:number,
 *   ageMs:number
 * }) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export const withLspSession = async (options, fn) => {
  const enabled = options?.enabled !== false;
  if (!enabled) {
    const singleSession = createSession({
      ...options,
      providerId: options?.providerId || options?.cmd || 'lsp',
      workspaceKey: options?.workspaceKey || options?.repoRoot || options?.cwd || ''
    });
    try {
      return await fn({
        client: singleSession.client,
        guard: singleSession.guard,
        lifecycleHealth: singleSession.lifecycleHealth,
        pooled: false,
        sessionKey: null,
        reused: false,
        recycleCount: 0,
        ageMs: 0
      });
    } finally {
      await disposeSessionClient(singleSession);
    }
  }

  const resolved = getOrCreateSession({
    ...options,
    providerId: options?.providerId || options?.cmd || 'lsp',
    workspaceKey: options?.workspaceKey || options?.repoRoot || options?.cwd || '',
    args: normalizeArgs(options?.args)
  });
  const session = resolved.session;
  const prev = session.queue;
  const barrier = createPendingBarrier();
  session.queue = barrier.promise.catch(() => {});
  session.activeCount += 1;
  session.lastUsedAt = Date.now();
  if (resolved.reused) session.reuseCount += 1;
  await prev;
  session.handlers.onNotification = typeof options?.onNotification === 'function'
    ? options.onNotification
    : null;
  session.handlers.onRequest = typeof options?.onRequest === 'function'
    ? options.onRequest
    : null;
  session.handlers.stderrFilter = typeof options?.stderrFilter === 'function'
    ? options.stderrFilter
    : null;
  session.handlers.onStderrLine = typeof options?.onStderrLine === 'function'
    ? options.onStderrLine
    : null;
  try {
    return await fn({
      client: session.client,
      guard: session.guard,
      lifecycleHealth: session.lifecycleHealth,
      pooled: true,
      sessionKey: session.key,
      reused: resolved.reused,
      recycleCount: session.recycleCount,
      ageMs: Math.max(0, Date.now() - Number(session.createdAt || Date.now()))
    });
  } finally {
    session.handlers.onNotification = null;
    session.handlers.onRequest = null;
    session.handlers.stderrFilter = null;
    session.handlers.onStderrLine = null;
    session.activeCount = Math.max(0, session.activeCount - 1);
    session.lastUsedAt = Date.now();
    if (shouldExpireForLifetime(session) && session.activeCount === 0) {
      session.recycleCount += 1;
      sessions.delete(session.key);
      await disposeSessionClient(session);
    }
    barrier.resolve();
  }
};

/**
 * Test-only hooks for deterministic session-pool assertions.
 */
export const __testLspSessionPool = {
  killAllNow() {
    killAllSessionsNow();
  },
  async reset() {
    const live = Array.from(sessions.values());
    killAllSessionsNow();
    for (const session of live) {
      await disposeSessionClient(session);
    }
  },
  getSize() {
    return sessions.size;
  }
};
