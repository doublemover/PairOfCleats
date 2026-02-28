import { createLspClient } from '../../lsp/client.js';
import { createToolingGuard, createToolingLifecycleHealth } from '../shared.js';
import { coercePositiveInt } from '../../../../shared/number-coerce.js';
import { sleep } from '../../../../shared/sleep.js';
import { stableStringify } from '../../../../shared/stable-json.js';

const DEFAULT_IDLE_TIMEOUT_MS = 1_500;
const DEFAULT_MAX_LIFETIME_MS = 10 * 60_000;
const DEFAULT_CLEANUP_INTERVAL_MS = 500;
const SESSION_STATE = Object.freeze({
  NEW: 'new',
  INITIALIZING: 'initializing',
  READY: 'ready',
  POISONED: 'poisoned',
  RETIRED: 'retired'
});

const sessions = new Map();
const disposalBarriers = new Map();
let cleanupTimer = null;
let cleanupPassQueue = Promise.resolve();
let exitCleanupInstalled = false;
const testHooks = {
  disposeDelayMs: 0
};

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
  if (session.disposePromise && typeof session.disposePromise.then === 'function') {
    await session.disposePromise;
    return;
  }
  const runDispose = async () => {
    session.disposed = true;
    session.state = SESSION_STATE.RETIRED;
    const delayMs = toNonNegativeInt(testHooks.disposeDelayMs, 0);
    if (delayMs > 0) {
      await sleep(delayMs);
    }
    try {
      if (session.client && typeof session.client.shutdownAndExit === 'function') {
        await session.client.shutdownAndExit();
      }
    } catch {}
    killSessionClient(session);
  };
  session.disposePromise = runDispose();
  session.disposed = true;
  await session.disposePromise;
};

const awaitSessionDisposalBarrier = async (key) => {
  const normalizedKey = String(key || '');
  if (!normalizedKey) return;
  const pending = disposalBarriers.get(normalizedKey);
  if (!pending) return;
  await pending;
};

const enqueueSessionDisposal = (session, {
  killFirst = false
} = {}) => {
  if (!session || typeof session !== 'object') return Promise.resolve();
  const key = String(session.key || '');
  const previous = key ? disposalBarriers.get(key) : null;
  const run = async () => {
    if (previous) {
      await previous.catch(() => {});
    }
    if (killFirst) {
      killSessionClient(session);
    }
    await disposeSessionClient(session);
  };
  const tracked = run().catch(() => {});
  if (key) {
    disposalBarriers.set(key, tracked);
    tracked.finally(() => {
      if (disposalBarriers.get(key) === tracked) {
        disposalBarriers.delete(key);
      }
    });
  }
  return tracked;
};

const shouldExpireForLifetime = (session, now = Date.now()) => (
  Number.isFinite(session?.maxLifetimeMs)
  && session.maxLifetimeMs > 0
  && ((now - Number(session?.createdAt || now)) >= session.maxLifetimeMs)
);

const readSessionTransportGeneration = (session) => {
  const generation = session?.client && typeof session.client.getGeneration === 'function'
    ? Number(session.client.getGeneration())
    : Number(session?.transportGeneration);
  if (!Number.isFinite(generation) || generation < 0) return 0;
  return Math.floor(generation);
};

const isSessionTransportRunning = (session) => (
  Boolean(
    session?.client
    && typeof session.client.isTransportRunning === 'function'
    && session.client.isTransportRunning()
  )
);

const refreshSessionState = (session) => {
  if (!session || typeof session !== 'object') return;
  const nextGeneration = readSessionTransportGeneration(session);
  if (nextGeneration !== Number(session.transportGeneration || 0)) {
    session.transportGeneration = nextGeneration;
  }
  if (session.state === SESSION_STATE.POISONED || session.state === SESSION_STATE.RETIRED) return;
  const initializedGeneration = Number(session.initializedGeneration ?? -1);
  const running = isSessionTransportRunning(session);
  if (!running) {
    session.state = SESSION_STATE.NEW;
    return;
  }
  if (initializedGeneration !== session.transportGeneration) {
    session.state = SESSION_STATE.NEW;
    session.initializeResult = null;
    return;
  }
  session.state = SESSION_STATE.READY;
};

const markSessionInitializing = (session) => {
  if (!session || typeof session !== 'object') return;
  session.transportGeneration = readSessionTransportGeneration(session);
  session.state = SESSION_STATE.INITIALIZING;
};

const markSessionReady = (session, initializeResult = null) => {
  if (!session || typeof session !== 'object') return;
  session.transportGeneration = readSessionTransportGeneration(session);
  session.initializedGeneration = session.transportGeneration;
  session.initializeResult = initializeResult ?? null;
  session.poisonReason = null;
  session.state = SESSION_STATE.READY;
};

const markSessionPoisoned = (session, reason = 'unknown') => {
  if (!session || typeof session !== 'object') return;
  session.poisonReason = typeof reason === 'string' && reason.trim()
    ? reason.trim()
    : 'unknown';
  session.state = SESSION_STATE.POISONED;
};

const shouldInitializeSession = (session) => {
  if (!session || typeof session !== 'object') return true;
  if (session.state === SESSION_STATE.POISONED || session.state === SESSION_STATE.RETIRED) return true;
  const running = isSessionTransportRunning(session);
  if (!running) return true;
  const transportGeneration = readSessionTransportGeneration(session);
  const initializedGeneration = Number(session.initializedGeneration ?? -1);
  return initializedGeneration !== transportGeneration || session.state !== SESSION_STATE.READY;
};

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
    options,
    transportGeneration: 0,
    initializedGeneration: -1,
    initializeResult: null,
    state: SESSION_STATE.NEW,
    poisonReason: null
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
  disposalBarriers.clear();
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
    refreshSessionState(session);
    if (session.state === SESSION_STATE.POISONED) {
      sessions.delete(key);
      await enqueueSessionDisposal(session);
      continue;
    }
    const idleMs = now - Number(session.lastUsedAt || now);
    const idleTimeoutMs = toPositiveInt(session.idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS, 1000);
    if (idleMs < idleTimeoutMs) continue;
    sessions.delete(key);
    await enqueueSessionDisposal(session);
  }
};

const ensureCleanupTimer = () => {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    cleanupPassQueue = cleanupPassQueue
      .then(() => runCleanupPass())
      .catch(() => {});
  }, DEFAULT_CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();
  if (!exitCleanupInstalled) {
    exitCleanupInstalled = true;
    process.once('beforeExit', () => {
      killAllSessionsNow();
    });
    process.once('exit', () => {
      killAllSessionsNow();
    });
  }
};

const getOrCreateSession = async (options) => {
  const key = buildSessionKey(options);
  await awaitSessionDisposalBarrier(key);
  const now = Date.now();
  const existing = sessions.get(key);
  if (existing && !existing.disposed) {
    refreshSessionState(existing);
    if (existing.state === SESSION_STATE.POISONED && existing.activeCount === 0) {
      sessions.delete(key);
      await enqueueSessionDisposal(existing, { killFirst: true });
    } else {
      const idleTimeoutMs = toPositiveInt(existing.idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS, 1000);
      const idleExpired = (now - Number(existing.lastUsedAt || now)) >= idleTimeoutMs;
      if ((shouldExpireForLifetime(existing, now) || idleExpired) && existing.activeCount === 0) {
        sessions.delete(key);
        await enqueueSessionDisposal(existing, { killFirst: true });
      } else {
        existing.lastUsedAt = now;
        return { session: existing, reused: true };
      }
    }
  }
  await awaitSessionDisposalBarrier(key);
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

  const resolved = await getOrCreateSession({
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
  refreshSessionState(session);
  const leaseMarkPoisoned = (reason = 'unknown') => {
    markSessionPoisoned(session, reason);
  };
  const leaseMarkInitialized = (initializeResult = null) => {
    markSessionReady(session, initializeResult);
  };
  const leaseMarkInitializing = () => {
    markSessionInitializing(session);
  };
  try {
    return await fn({
      client: session.client,
      guard: session.guard,
      lifecycleHealth: session.lifecycleHealth,
      pooled: true,
      sessionKey: session.key,
      reused: resolved.reused,
      recycleCount: session.recycleCount,
      ageMs: Math.max(0, Date.now() - Number(session.createdAt || Date.now())),
      state: session.state,
      transportGeneration: readSessionTransportGeneration(session),
      initializationResult: session.initializeResult,
      shouldInitialize: shouldInitializeSession(session),
      isTransportRunning: isSessionTransportRunning(session),
      markInitializing: leaseMarkInitializing,
      markInitialized: leaseMarkInitialized,
      markPoisoned: leaseMarkPoisoned
    });
  } finally {
    session.handlers.onNotification = null;
    session.handlers.onRequest = null;
    session.handlers.stderrFilter = null;
    session.handlers.onStderrLine = null;
    session.activeCount = Math.max(0, session.activeCount - 1);
    session.lastUsedAt = Date.now();
    refreshSessionState(session);
    if (session.state === SESSION_STATE.POISONED && session.activeCount === 0) {
      session.recycleCount += 1;
      sessions.delete(session.key);
      await disposeSessionClient(session);
    }
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
    testHooks.disposeDelayMs = 0;
    cleanupPassQueue = Promise.resolve();
  },
  getSize() {
    return sessions.size;
  },
  setDisposeDelayMs(value) {
    testHooks.disposeDelayMs = toNonNegativeInt(value, 0);
  },
  getPendingDisposals() {
    return disposalBarriers.size;
  }
};
