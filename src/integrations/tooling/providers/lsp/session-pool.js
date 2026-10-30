import crypto from 'node:crypto';
import { isAbortError, raceAbort, throwIfAborted } from '../../../../shared/abort.js';
import { createRetainedLspClient } from '../../lsp/managed-client.js';
import { normalizeManagedRuntimeCommands } from '../../../../index/tooling/managed-command-lifetime.js';
import { createToolingGuard, createToolingLifecycleHealth } from '../shared.js';
import { coercePositiveInt } from '../../../../shared/number-coerce.js';
import { createTimeoutError, runWithTimeout } from '../../../../shared/promise-timeout.js';
import { sleep } from '../../../../shared/sleep.js';
import { stableStringify } from '../../../../shared/stable-json.js';
import { currentRunResourceScope } from '../../../../shared/lifecycle/run-scope.js';
import { retainRunSession } from './run-ownership.js';
import { createVfsMaterializationSession } from '../../../../index/tooling/vfs/disk.js';
import { LSP_SHORT_QUARANTINE_MS, LSP_EXTENDED_QUARANTINE_MS } from './health-policy.js';
import { describeStorageFailure } from '../../../../shared/storage/failure-observation.js';
import { readErrorDataProperty } from '../../../../shared/error-data.js';

const DEFAULT_IDLE_TIMEOUT_MS = 1_500;
const DEFAULT_MAX_LIFETIME_MS = 10 * 60_000;
const DEFAULT_CLEANUP_INTERVAL_MS = 500;
const DEFAULT_DISPOSE_TIMEOUT_MS = 8_000;
const DEFAULT_KILL_TIMEOUT_MS = 4_000;
const DEFAULT_MAX_SESSION_ENTRIES = 64;
const DEFAULT_DRAIN_TIMEOUT_MS = 20_000;
// Node's original DOMException name getter reads its private WeakMap and brand
// checks the receiver, without consulting receiver properties or coercion.
// https://github.com/nodejs/node/blob/v26.13.0/lib/internal/per_context/domexception.js
const nativeDomExceptionName = typeof DOMException === 'function'
  ? Object.getOwnPropertyDescriptor(DOMException.prototype, 'name')?.get : null;
const SESSION_STATE = Object.freeze({
  NEW: 'new',
  INITIALIZING: 'initializing',
  READY: 'ready',
  POISONED: 'poisoned',
  RETIRED: 'retired'
});

const sessions = new Map();
const sessionHealthRecords = new Map();
const disposalBarriers = new Map();
const unconfirmedDisposals = new Map();
const creationBarriers = new Map();
const sessionPoolMetrics = {
  cleanupPassFailures: 0,
  disposalFailures: 0,
  creationBarrierFailures: 0,
  queueBarrierFailures: 0,
  maxSessionEvictions: 0,
  admissionWaiters: 0,
  leaseQueueWaiters: 0,
  admissionHighWater: 0,
  admissionWaitMs: 0,
  admissionCancelled: 0
};
let cleanupTimer = null;
let cleanupPassQueue = Promise.resolve();
let exitCleanupInstalled = false;
let beforeExitCleanupPromise = null;
let drainSessionPoolPromise = null;
const activeDisposals = new Set();
const disposalWorkBySession = new WeakMap(), nativeDisposalBySession = new WeakMap();
const testHooks = {
  disposeDelayMs: 0,
  shortQuarantineMs: null,
  extendedQuarantineMs: null
};

const QUARANTINE_LEVEL = Object.freeze({
  SHORT: 'short',
  EXTENDED: 'extended'
});

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

const resolveShortQuarantineMs = () => (
  toPositiveInt(testHooks.shortQuarantineMs, LSP_SHORT_QUARANTINE_MS, 100)
);

const resolveExtendedQuarantineMs = () => (
  toPositiveInt(testHooks.extendedQuarantineMs, LSP_EXTENDED_QUARANTINE_MS, 100)
);

const createSessionHealthRecord = () => ({
  activeLeaseCount: 0,
  startupFailureCount: 0,
  handshakeFailureCount: 0,
  transportFailureCount: 0,
  protocolParseFailureCount: 0,
  timeoutFailureCount: 0,
  quarantineLevel: null,
  quarantineReasonCode: null,
  quarantineUntil: 0,
  quarantineTransitions: 0,
  recoveryProbeActive: false,
  recoveryProbeAttempts: 0,
  recoveryProbeSuccesses: 0,
  recoveryProbeFailures: 0,
  lastRecoveryAt: null,
  lastRecoveryResult: null,
  lastFailureReasonCode: null
});

const retireUnusedHealthySessionRecords = () => {
  for (const [key, record] of sessionHealthRecords) {
    if (sessions.has(key) || creationBarriers.has(key) || disposalBarriers.has(key)
      || record.activeLeaseCount > 0) continue;
    // Retain every failure/recovery/quarantine record, including expired history.
    // Only a never-failed record with no remaining owner can be discarded.
    if (record.startupFailureCount || record.handshakeFailureCount || record.transportFailureCount
      || record.protocolParseFailureCount || record.timeoutFailureCount || record.quarantineLevel
      || record.quarantineReasonCode || record.quarantineUntil || record.quarantineTransitions
      || record.recoveryProbeActive || record.recoveryProbeAttempts || record.recoveryProbeSuccesses
      || record.recoveryProbeFailures || record.lastRecoveryAt || record.lastRecoveryResult
      || record.lastFailureReasonCode) continue;
    sessionHealthRecords.delete(key);
  }
};

const getOrCreateSessionHealthRecord = (key) => {
  const normalizedKey = String(key || '');
  const existing = sessionHealthRecords.get(normalizedKey);
  if (existing) return existing;
  const next = createSessionHealthRecord();
  sessionHealthRecords.set(normalizedKey, next);
  return next;
};

const isQuarantineLevel = (value) => (
  value === QUARANTINE_LEVEL.SHORT || value === QUARANTINE_LEVEL.EXTENDED
);

const resolveQuarantineState = (record) => {
  const now = Date.now();
  const active = Boolean(
    record
    && isQuarantineLevel(record.quarantineLevel)
    && Number(record.quarantineUntil) > now
  );
  return {
    level: isQuarantineLevel(record?.quarantineLevel) ? record.quarantineLevel : null,
    active,
    remainingMs: active ? Math.max(0, Number(record.quarantineUntil) - now) : 0,
    reasonCode: record?.quarantineReasonCode || null,
    recoveryProbeActive: record?.recoveryProbeActive === true,
    recoveryProbeAttempts: Number(record?.recoveryProbeAttempts) || 0,
    recoveryProbeSuccesses: Number(record?.recoveryProbeSuccesses) || 0,
    recoveryProbeFailures: Number(record?.recoveryProbeFailures) || 0,
    lastRecoveryAt: record?.lastRecoveryAt || null,
    lastRecoveryResult: record?.lastRecoveryResult || null,
    lastFailureReasonCode: record?.lastFailureReasonCode || null,
    quarantineTransitions: Number(record?.quarantineTransitions) || 0
  };
};

const armQuarantine = (record, level, reasonCode) => {
  if (!record) return resolveQuarantineState(record);
  const normalizedLevel = level === QUARANTINE_LEVEL.EXTENDED
    ? QUARANTINE_LEVEL.EXTENDED
    : QUARANTINE_LEVEL.SHORT;
  const durationMs = normalizedLevel === QUARANTINE_LEVEL.EXTENDED
    ? resolveExtendedQuarantineMs()
    : resolveShortQuarantineMs();
  const now = Date.now();
  record.quarantineLevel = normalizedLevel;
  record.quarantineReasonCode = String(reasonCode || 'tooling_quarantined');
  record.quarantineUntil = Math.max(Number(record.quarantineUntil) || 0, now + durationMs);
  record.quarantineTransitions = (Number(record.quarantineTransitions) || 0) + 1;
  record.lastFailureReasonCode = record.quarantineReasonCode;
  record.recoveryProbeActive = false;
  return resolveQuarantineState(record);
};

const clearQuarantine = (record) => {
  if (!record) return resolveQuarantineState(record);
  record.quarantineLevel = null;
  record.quarantineReasonCode = null;
  record.quarantineUntil = 0;
  record.recoveryProbeActive = false;
  return resolveQuarantineState(record);
};

const beginRecoveryProbe = (record) => {
  if (!record) return resolveQuarantineState(record);
  record.recoveryProbeActive = true;
  record.recoveryProbeAttempts = (Number(record.recoveryProbeAttempts) || 0) + 1;
  return resolveQuarantineState(record);
};

const completeRecoveryProbe = (record, success, reasonCode = null) => {
  if (!record) return resolveQuarantineState(record);
  record.recoveryProbeActive = false;
  record.lastRecoveryAt = new Date().toISOString();
  record.lastRecoveryResult = success === true ? 'recovered' : 'failed';
  if (success === true) {
    record.recoveryProbeSuccesses = (Number(record.recoveryProbeSuccesses) || 0) + 1;
    record.startupFailureCount = 0;
    record.handshakeFailureCount = 0;
    record.transportFailureCount = 0;
    record.protocolParseFailureCount = 0;
    record.timeoutFailureCount = 0;
    return clearQuarantine(record);
  }
  record.recoveryProbeFailures = (Number(record.recoveryProbeFailures) || 0) + 1;
  return armQuarantine(record, QUARANTINE_LEVEL.EXTENDED, reasonCode || record.lastFailureReasonCode || 'tooling_quarantined');
};

const resolveQuarantineForFailure = (reason, lifecycleState, record = null) => {
  const normalizedReason = String(reason || 'tooling_quarantined').trim() || 'tooling_quarantined';
  if (lifecycleState?.lastFailureCategory?.category === 'protocol_parse_failure') {
    return { level: QUARANTINE_LEVEL.EXTENDED, reasonCode: 'protocol_parse_error' };
  }
  if (normalizedReason === 'protocol_parse_error') {
    return { level: QUARANTINE_LEVEL.EXTENDED, reasonCode: normalizedReason };
  }
  if (normalizedReason === 'initialize_failed' || normalizedReason === 'initialize_state_desync') {
    return { level: QUARANTINE_LEVEL.SHORT, reasonCode: normalizedReason };
  }
  if (normalizedReason === 'transport_failure' || normalizedReason === 'startup_failure') {
    return {
      level: Number(record?.transportFailureCount || record?.startupFailureCount || 0) >= 2
        ? QUARANTINE_LEVEL.EXTENDED
        : QUARANTINE_LEVEL.SHORT,
      reasonCode: normalizedReason
    };
  }
  if (normalizedReason === 'request_timeout') {
    const timeoutRate = Number(lifecycleState?.requestTimeoutRatePerMinute) || 0;
    const timeoutCount = Number(record?.timeoutFailureCount) || 0;
    return {
      level: timeoutCount >= 4 || timeoutRate >= 4 ? QUARANTINE_LEVEL.EXTENDED : QUARANTINE_LEVEL.SHORT,
      reasonCode: normalizedReason
    };
  }
  if ((Number(lifecycleState?.fdPressureDensityPerMinute) || 0) >= 4) {
    return { level: QUARANTINE_LEVEL.SHORT, reasonCode: 'fd_pressure_density' };
  }
  return { level: QUARANTINE_LEVEL.SHORT, reasonCode: normalizedReason };
};

const emitPoolWarning = (log, message) => {
  if (typeof log === 'function') {
    try { Promise.resolve(log(message)).catch(() => {}); } catch { /* Diagnostics cannot replace disposal evidence. */ }
    return;
  }
  try {
    process.emitWarning(message, { code: 'LSP_SESSION_POOL_WARNING' });
  } catch {}
};

const poolFailureSnapshot = error => {
  // Logging owns no settlement decision. Project only own string data without
  // calling user getters/coercion; the exact rejection and its resource owner
  // remain in the disposal barrier and public drain failures, unchanged.
  const snapshot = Object.create(null);
  try {
    if (typeof error === 'string') snapshot.message = error.slice(0, 512);
    else if (error !== null && ['object', 'function'].includes(typeof error)) {
      for (const key of ['name', 'code', 'message']) {
        const value = readErrorDataProperty(error, key);
        if (typeof value === 'string') snapshot[key] = value.slice(0, 512);
      }
    }
  } catch { /* Proxy descriptor inspection cannot replace the original cause. */ }
  return snapshot;
};
const describePoolFailure = error => describeStorageFailure(poolFailureSnapshot(error),
  { phase: 'lsp-pool-warning', defaultMessage: 'LSP operation failed.' }).message;
const isPoolAbortError = error => {
  const snapshot = poolFailureSnapshot(error);
  if (isAbortError(snapshot)) return true;
  if (nativeDomExceptionName && snapshot.name === undefined) {
    try { return Reflect.apply(nativeDomExceptionName, error, []) === 'AbortError'; }
    catch { /* A forged/proxied receiver cannot supply native abort identity. */ }
  }
  return false;
};

const resolveMaxSessionEntries = (value) => (
  toPositiveInt(value, DEFAULT_MAX_SESSION_ENTRIES, 1)
);

const buildEnvFingerprint = (value) => {
  if (!value || typeof value !== 'object') return null;
  const normalizedEntries = Object.entries(value)
    .map(([key, envValue]) => [String(key || '').trim(), envValue])
    .filter(([key]) => key.length > 0)
    .map(([key, envValue]) => [key, envValue == null ? null : String(envValue)])
    .sort(([left], [right]) => left.localeCompare(right));
  if (!normalizedEntries.length) return null;
  return crypto.createHash('sha1').update(stableStringify(normalizedEntries)).digest('hex');
};

const buildSessionKey = ({
  repoRoot,
  providerId,
  workspaceKey,
  cmd,
  toolingRoot,
  managedRuntimeCommands,
  args,
  env,
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
    toolingRoot: String(toolingRoot || ''),
    managedRuntimeCommands: normalizeManagedRuntimeCommands(managedRuntimeCommands),
    args: normalizeArgs(args),
    envFingerprint: buildEnvFingerprint(env),
    initializationOptions: initializationOptions ?? null,
    cwd: String(cwd || ''),
    shell: shell === true,
    timeoutMs: toPositiveInt(timeoutMs, 60000, 1),
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

// Reserve under the existing key's creation owner, before publishing the
// session to another admission. Cancellation withdraws only this queued turn.
const reserveSessionTurn = (session, reused) => {
  const previous = session.queue, barrier = createPendingBarrier(), resolve = barrier.resolve;
  let released = false;
  session.queuedTurns += 1;
  barrier.resolve = () => {
    if (released) return;
    released = true; session.queuedTurns -= 1; resolve();
  };
  session.queue = barrier.promise;
  return { session, reused, previous, barrier };
};
const withdrawSessionTurn = reservation => {
  void reservation.previous.then(reservation.barrier.resolve, reservation.barrier.resolve);
};
const readMaterializationGeneration = options => {
  const value = options.materializationGeneration;
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError('LSP materialization generation requires its actual source digest.');
  return value;
};

const awaitWithTimeout = async (promise, timeoutMs) => {
  const resolvedTimeoutMs = toPositiveInt(timeoutMs, DEFAULT_DISPOSE_TIMEOUT_MS, 100);
  let timeoutHandle = null;
  let timedOut = false;
  let value;
  try {
    value = await Promise.race([
      Promise.resolve(promise),
      new Promise((resolve) => {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          resolve();
        }, resolvedTimeoutMs);
      })
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
  return { timedOut, value };
};

const trackDisposalPromise = (promise) => {
  if (!promise || typeof promise.then !== 'function') return Promise.resolve();
  activeDisposals.add(promise);
  promise.then(() => activeDisposals.delete(promise), () => activeDisposals.delete(promise));
  return promise;
};

const killSessionClient = (session, { sync = false } = {}) => {
  if (!session || typeof session !== 'object') return;
  if (sync && session.client && typeof session.client.killSync === 'function') return session.client.killSync();
  if (session.client && typeof session.client.kill === 'function') return session.client.kill();
};

const disposeSessionClient = async (session) => {
  if (!session || typeof session !== 'object') return;
  if (session.disposePromise && typeof session.disposePromise.then === 'function') {
    await session.disposePromise;
    return;
  }
  const runDispose = async () => {
    session.state = SESSION_STATE.RETIRED;
    session.materializations.retire();
    const delayMs = toNonNegativeInt(testHooks.disposeDelayMs, 0);
    if (delayMs > 0) {
      await sleep(delayMs);
    }
    if (!session.nativeDisposalConfirmed) {
      let shutdownError = null;
      try {
        if (session.client && typeof session.client.shutdownAndExit === 'function') {
          await awaitWithTimeout(
            session.client.shutdownAndExit(),
            DEFAULT_DISPOSE_TIMEOUT_MS
          );
        }
      } catch (error) { shutdownError = error; }
      const outcome = await awaitWithTimeout(
        Promise.resolve(killSessionClient(session)),
        DEFAULT_KILL_TIMEOUT_MS
      );
      const confirmsExit = value => Array.isArray(value) ? value.length > 0 && value.every(confirmsExit)
        : value?.exitObserved === true;
      const resourceWait = typeof session.client?.waitForResourceSettlement === 'function'
        ? await awaitWithTimeout(session.client.waitForResourceSettlement(), DEFAULT_KILL_TIMEOUT_MS)
        : { timedOut: false };
      // Ask the retained owner even on pending disposal so its exact delayed
      // child-close notification can reconcile ownership without a pool lease.
      await session.client?.releaseManagedInstallation?.();
      const evidence = session.client?.getTerminationEvidence?.();
      if (outcome.timedOut || resourceWait.timedOut || !(evidence ? (evidence.settled ?? evidence.exitObserved) === true : confirmsExit(outcome.value))) {
        throw Object.assign(new Error('LSP disposal did not confirm child exit.'), {
          code: 'ERR_LSP_DISPOSAL_UNCONFIRMED', termination: { timedOut: outcome.timedOut, ...evidence, result: outcome.value },
          ...(shutdownError ? { cleanupErrors: [shutdownError] } : {})
        });
      }
      session.nativeDisposalConfirmed = true;
    }
    session.materializations.releaseAfterClosure();
    session.disposed = true;
    unconfirmedDisposals.delete(session.key);
    return { exitObserved: true };
  };
  session.disposePromise = runDispose();
  nativeDisposalBySession.set(session, session.disposePromise);
  try { return await session.disposePromise; }
  catch (error) { session.disposePromise = null; throw error; }
};

const awaitSessionDisposalBarrier = async (key, signal) => {
  const normalizedKey = String(key || '');
  if (!normalizedKey) return;
  const pending = disposalBarriers.get(normalizedKey);
  if (!pending) return;
  await raceAbort(signal, pending);
};

const withSessionCreationBarrier = async (key, operation, signal) => {
  const normalizedKey = String(key || '');
  if (typeof operation !== 'function') {
    throw new TypeError('withSessionCreationBarrier requires an operation function.');
  }
  if (!normalizedKey) {
    return await operation();
  }
  while (true) {
    throwIfAborted(signal);
    const pending = creationBarriers.get(normalizedKey);
    if (pending) {
      await raceAbort(signal, pending.catch((error) => {
        sessionPoolMetrics.creationBarrierFailures += 1;
        emitPoolWarning(
          null,
          `[tooling:lsp] session creation barrier failed for key=${normalizedKey}: ${describePoolFailure(error)}`
        );
      }));
      continue;
    }
    const barrier = createPendingBarrier();
    creationBarriers.set(normalizedKey, barrier.promise);
    try {
      return await operation();
    } finally {
      if (creationBarriers.get(normalizedKey) === barrier.promise) {
        creationBarriers.delete(normalizedKey);
      }
      barrier.resolve();
    }
  }
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
    if (killFirst && !session.nativeDisposalConfirmed) {
      const killResult = await awaitWithTimeout(
        Promise.resolve(killSessionClient(session)),
        DEFAULT_KILL_TIMEOUT_MS
      );
      if (killResult.timedOut) {
        emitPoolWarning(
          session?.options?.log,
          `[tooling:lsp] timed out waiting for kill-first disposal step for `
            + `${session?.lifecycleName || session?.key || 'session'}`
        );
      }
    }
    await disposeSessionClient(session);
  };
  const tracked = trackDisposalPromise(run().catch((error) => {
    if (!session.disposalFailureReported) {
      session.disposalFailureReported = true;
      sessionPoolMetrics.disposalFailures += 1;
    }
    unconfirmedDisposals.set(key, session);
    emitPoolWarning(
      session?.options?.log,
      `[tooling:lsp] session disposal failed for ${session?.lifecycleName || session?.key || 'session'}: ` +
      `${describePoolFailure(error)}`
    );
    throw error;
  }));
  tracked.catch(() => {});
  disposalWorkBySession.set(session, tracked);
  if (key) {
    disposalBarriers.set(key, tracked);
    tracked.then(() => {
      if (disposalBarriers.get(key) === tracked) {
        disposalBarriers.delete(key);
      }
    }, () => {});
  }
  return tracked;
};

const evictIdleSessionsForCapacity = async ({ maxEntries, protectedKey = null } = {}) => {
  const cap = resolveMaxSessionEntries(maxEntries);
  if (sessions.size <= cap) return;
  for (const [key, session] of sessions.entries()) {
    if (sessions.size <= cap) break;
    if (!session || key === protectedKey) continue;
    if (session.activeCount > 0 || session.queuedTurns > 0) continue;
    sessions.delete(key);
    sessionPoolMetrics.maxSessionEvictions += 1;
    await enqueueSessionDisposal(session, { killFirst: true });
  }
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
  if (session.lifecycleHealth && typeof session.lifecycleHealth.noteHandshakeSuccess === 'function') {
    session.lifecycleHealth.noteHandshakeSuccess();
  }
  session.state = SESSION_STATE.READY;
};

const markSessionPoisoned = (session, reason = 'unknown') => {
  if (!session || typeof session !== 'object') return;
  session.poisonReason = typeof reason === 'string' && reason.trim()
    ? reason.trim()
    : 'unknown';
  if (session.lifecycleHealth) {
    if ((session.poisonReason === 'initialize_failed' || session.poisonReason === 'initialize_state_desync')
      && typeof session.lifecycleHealth.noteHandshakeFailure === 'function') {
      session.lifecycleHealth.noteHandshakeFailure({ code: session.poisonReason, message: session.poisonReason });
    }
    if (session.poisonReason === 'request_timeout' && typeof session.lifecycleHealth.noteRequestTimeout === 'function') {
      session.lifecycleHealth.noteRequestTimeout({ code: session.poisonReason, message: session.poisonReason });
    }
  }
  if (session.healthRecord) {
    const lifecycleState = session.lifecycleHealth?.getState ? session.lifecycleHealth.getState() : null;
    if (lifecycleState?.lastFailureCategory?.category === 'protocol_parse_failure') {
      session.healthRecord.protocolParseFailureCount = (Number(session.healthRecord.protocolParseFailureCount) || 0) + 1;
    }
    if (session.poisonReason === 'initialize_failed' || session.poisonReason === 'initialize_state_desync') {
      session.healthRecord.handshakeFailureCount = (Number(session.healthRecord.handshakeFailureCount) || 0) + 1;
    }
    if (session.poisonReason === 'request_timeout') {
      session.healthRecord.timeoutFailureCount = (Number(session.healthRecord.timeoutFailureCount) || 0) + 1;
    }
    if (session.poisonReason === 'transport_failure') {
      session.healthRecord.transportFailureCount = (Number(session.healthRecord.transportFailureCount) || 0) + 1;
      if ((Number(lifecycleState?.startupFailures) || 0) > 0) {
        session.healthRecord.startupFailureCount = Math.max(
          Number(session.healthRecord.startupFailureCount) || 0,
          Number(lifecycleState.startupFailures) || 0
        );
      }
    }
    const quarantine = resolveQuarantineForFailure(session.poisonReason, lifecycleState, session.healthRecord);
    if (session.healthRecord.recoveryProbeActive === true) {
      completeRecoveryProbe(session.healthRecord, false, quarantine.reasonCode);
    } else {
      armQuarantine(session.healthRecord, quarantine.level, quarantine.reasonCode);
    }
  }
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

const createSession = async (options) => {
  const key = buildSessionKey(options);
  const now = Date.now();
  const healthRecord = options.healthRecord || getOrCreateSessionHealthRecord(key);
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
  const client = await createRetainedLspClient({
    subprocessOwnershipId: `tooling-lsp-session:${crypto.randomUUID()}`,
    cmd: options.cmd,
    toolingRoot: options.toolingRoot,
    managedRuntimeCommands: options.managedRuntimeCommands,
    args: options.args,
    cwd: options.cwd,
    env: options.env,
    shell: options.shell,
    providerId: options.providerId,
    sessionKey: key,
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
  const readTermination = client.getTerminationEvidence;
  const materializations = createVfsMaterializationSession({
    isClosed: () => typeof readTermination === 'function' && readTermination.call(client)?.settled === true
  });
  return {
    key,
    client,
    materializations,
    guard,
    lifecycleHealth,
    queue: Promise.resolve(),
    createdAt: now,
    lastUsedAt: now,
    activeCount: 0,
    queuedTurns: 0,
    reuseCount: 0,
    recycleCount: 0,
    idleTimeoutMs: toPositiveInt(options.sessionIdleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS, 1000),
    maxLifetimeMs: toPositiveInt(options.sessionMaxLifetimeMs, DEFAULT_MAX_LIFETIME_MS, 1000),
    lifecycleName: options.lifecycleName || options.cmd,
    handlers,
    options,
    healthRecord,
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

const uniquePromiseList = (entries) => {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    if (!entry || typeof entry.then !== 'function') continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out;
};

const waitForAllSettledWithTimeout = async (promises, timeoutMs) => {
  const list = uniquePromiseList(promises);
  if (!list.length) return { timedOut: false, settled: [] };
  const resolvedTimeoutMs = toPositiveInt(timeoutMs, DEFAULT_DRAIN_TIMEOUT_MS, 100);
  try {
    const settled = await runWithTimeout(
      () => Promise.allSettled(list),
      {
        timeoutMs: resolvedTimeoutMs,
        errorFactory: () => createTimeoutError({
          message: `[tooling:lsp] session pool drain timed out after ${resolvedTimeoutMs}ms.`,
          code: 'LSP_SESSION_POOL_DRAIN_TIMEOUT',
          retryable: false,
          meta: { timeoutMs: resolvedTimeoutMs, pending: list.length }
        })
      }
    );
    return { timedOut: false, settled };
  } catch (error) {
    if (error?.code === 'LSP_SESSION_POOL_DRAIN_TIMEOUT') {
      return { timedOut: true, settled: [], error };
    }
    throw error;
  }
};

const hardKillSessionsSync = (sessionsToKill) => {
  const failures = [];
  for (const session of sessionsToKill) {
    try { killSessionClient(session, { sync: true }); } catch (error) {
      failures.push(error);
      unconfirmedDisposals.set(session.key, session);
      emitPoolWarning(session?.options?.log, `LSP hard kill failed: ${describePoolFailure(error)}`);
    }
  }
  return failures;
};

const killAllSessionsNow = () => {
  const live = Array.from(sessions.values());
  sessions.clear();
  disposalBarriers.clear();
  creationBarriers.clear();
  activeDisposals.clear();
  clearCleanupTimer();
  for (const session of live) {
    killSessionClient(session, { sync: true });
  }
};

const scheduleBeforeExitCleanup = () => {
  if (beforeExitCleanupPromise) return beforeExitCleanupPromise;
  const live = Array.from(sessions.values());
  sessions.clear();
  if (!live.length) {
    beforeExitCleanupPromise = Promise.resolve();
    return beforeExitCleanupPromise;
  }
  clearCleanupTimer();
  beforeExitCleanupPromise = Promise.allSettled(
    live.map((session) => enqueueSessionDisposal(session, { killFirst: true }))
  ).finally(() => {
    beforeExitCleanupPromise = null;
  });
  return beforeExitCleanupPromise;
};

const runCleanupPass = async () => {
  if (!sessions.size) {
    clearCleanupTimer();
    return;
  }
  const now = Date.now();
  const disposals = [];
  for (const [key, session] of sessions.entries()) {
    if (!session || session.activeCount > 0 || session.queuedTurns > 0) continue;
    refreshSessionState(session);
    if (session.state === SESSION_STATE.POISONED) {
      if (session.activeCount > 0 || sessions.get(key) !== session) continue;
      sessions.delete(key);
      disposals.push(enqueueSessionDisposal(session, { killFirst: true }));
      continue;
    }
    const idleMs = now - Number(session.lastUsedAt || now);
    const idleTimeoutMs = toPositiveInt(session.idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS, 1000);
    const lifetimeExpired = shouldExpireForLifetime(session, now);
    const idleExpired = idleMs >= idleTimeoutMs;
    if (!idleExpired && !lifetimeExpired) continue;
    if (session.activeCount > 0 || sessions.get(key) !== session) continue;
    sessions.delete(key);
    disposals.push(enqueueSessionDisposal(session, { killFirst: true }));
  }
  if (disposals.length > 0) {
    await Promise.allSettled(disposals);
  }
};

const ensureCleanupTimer = () => {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    cleanupPassQueue = cleanupPassQueue
      .then(() => runCleanupPass())
      .catch((error) => {
        sessionPoolMetrics.cleanupPassFailures += 1;
        emitPoolWarning(
          null,
          `[tooling:lsp] cleanup pass failed: ${describePoolFailure(error)}`
        );
      });
  }, DEFAULT_CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();
  if (!exitCleanupInstalled) {
    exitCleanupInstalled = true;
    process.once('beforeExit', () => {
      void scheduleBeforeExitCleanup();
    });
    process.once('exit', () => {
      killAllSessionsNow();
    });
  }
};

const getOrCreateSession = async (options) => {
  const materializationGeneration = readMaterializationGeneration(options);
  const key = buildSessionKey(options);
  const healthRecord = getOrCreateSessionHealthRecord(key);
  return await withSessionCreationBarrier(key, async () => {
    if (drainSessionPoolPromise) {
      await raceAbort(options.abortSignal, drainSessionPoolPromise.catch(() => {}));
    }
    await awaitSessionDisposalBarrier(key, options.abortSignal);
    throwIfAborted(options.abortSignal);
    const quarantineState = resolveQuarantineState(healthRecord);
    if (quarantineState.active) {
      const err = new Error(`LSP provider quarantined (${quarantineState.reasonCode || quarantineState.level || 'unknown'}).`);
      err.code = 'TOOLING_QUARANTINED';
      err.detail = quarantineState;
      throw err;
    }
    if (quarantineState.level && quarantineState.active !== true && quarantineState.recoveryProbeActive !== true) {
      beginRecoveryProbe(healthRecord);
    }
    const now = Date.now();
    let existing = sessions.get(key), generationRecycleCount = 0;
    if (existing && !existing.disposed && (existing.options.materializationGeneration ?? null) !== materializationGeneration) {
      // Holding this same creation barrier prevents later callers from joining
      // the old epoch. Its already-reserved turns retain their FIFO order.
      await raceAbort(options.abortSignal, existing.queue);
      await awaitSessionDisposalBarrier(key, options.abortSignal);
      throwIfAborted(options.abortSignal);
      if (sessions.get(key) === existing) sessions.delete(key);
      generationRecycleCount = existing.recycleCount + 1;
      if (!existing.disposed) await raceAbort(options.abortSignal, enqueueSessionDisposal(existing));
      existing = null;
    }
    if (existing && !existing.disposed) {
      refreshSessionState(existing);
      if (existing.state === SESSION_STATE.POISONED && existing.activeCount === 0 && existing.queuedTurns === 0) {
        sessions.delete(key);
        await enqueueSessionDisposal(existing, { killFirst: true });
      } else {
        const idleTimeoutMs = toPositiveInt(existing.idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS, 1000);
        const idleExpired = (now - Number(existing.lastUsedAt || now)) >= idleTimeoutMs;
        if ((shouldExpireForLifetime(existing, now) || idleExpired) && existing.activeCount === 0 && existing.queuedTurns === 0) {
          sessions.delete(key);
          await enqueueSessionDisposal(existing, { killFirst: true });
        } else {
          existing.lastUsedAt = now;
          // Refresh insertion order so capacity eviction remains LRU-like.
          sessions.delete(key);
          sessions.set(key, existing);
          return reserveSessionTurn(existing, true);
        }
      }
    }
    await awaitSessionDisposalBarrier(key, options.abortSignal);
    throwIfAborted(options.abortSignal);
    await evictIdleSessionsForCapacity({
      maxEntries: options?.sessionPoolMaxEntries,
      protectedKey: key
    });
    throwIfAborted(options.abortSignal);
    // Lease-only closures/signals must not become idle pooled-session state.
    const retainedOptions = { ...options, materializationGeneration, healthRecord };
    for (const field of ['abortSignal', 'onNotification', 'onRequest', 'stderrFilter', 'onStderrLine']) delete retainedOptions[field];
    const next = await createSession(retainedOptions);
    next.recycleCount = generationRecycleCount;
    const reservation = reserveSessionTurn(next, false);
    sessions.set(key, next);
    try {
      await evictIdleSessionsForCapacity({ maxEntries: options?.sessionPoolMaxEntries, protectedKey: key });
    } catch (error) { withdrawSessionTurn(reservation); throw error; }
    ensureCleanupTimer();
    return reservation;
  }, options.abortSignal);
};

/** Cancellation withdraws a waiter, never the shared creation/disposal owner or
 * an active predecessor. The small skipped barrier remains linked to prev.
 */
const retainPooledRunSession = (session, owner) => retainRunSession(session, owner, () => {
  const existing = disposalWorkBySession.get(session) || nativeDisposalBySession.get(session);
  if (existing) return existing;
  if (sessions.get(session.key) === session) sessions.delete(session.key);
  return enqueueSessionDisposal(session);
});

const acquireSessionTurn = async (options, owner) => {
  const signal = options.abortSignal, startedAt = Date.now();
  sessionPoolMetrics.admissionWaiters += 1;
  sessionPoolMetrics.admissionHighWater = Math.max(sessionPoolMetrics.admissionHighWater, sessionPoolMetrics.admissionWaiters);
  try {
    throwIfAborted(signal);
    // Install the wait observer before a creation callback can cancel its caller.
    const create = async () => {
      const resolved = await getOrCreateSession(options);
      // Pin waiting consumers before the exclusive turn. Abort withdraws only
      // the caller's wait; the original creation still joins its run's drain.
      try { retainPooledRunSession(resolved.session, owner); }
      catch (error) { withdrawSessionTurn(resolved); throw error; }
      return resolved;
    };
    const creation = owner ? owner.track(create) : Promise.resolve().then(create);
    let resolved;
    try { resolved = await raceAbort(signal, creation); }
    catch (error) { void creation.then(withdrawSessionTurn, () => {}); throw error; }
    const prev = resolved.previous, barrier = resolved.barrier;
    sessionPoolMetrics.leaseQueueWaiters += 1;
    try {
      throwIfAborted(signal);
      await raceAbort(signal, prev);
      throwIfAborted(signal);
    } catch (error) {
      // Resolving here directly would allow C to overtake the still-active A.
      void prev.then(barrier.resolve, barrier.resolve);
      throw error;
    } finally { sessionPoolMetrics.leaseQueueWaiters -= 1; }
    return { resolved, barrier };
  } catch (error) {
    if (isPoolAbortError(error)) sessionPoolMetrics.admissionCancelled += 1;
    throw error;
  } finally {
    sessionPoolMetrics.admissionWaiters -= 1;
    sessionPoolMetrics.admissionWaitMs += Math.max(0, Date.now() - startedAt);
  }
};

/**
 * Drain and dispose all pooled LSP sessions.
 *
 * This is used by explicit runtime teardown paths so closeout does not rely on
 * idle timers or process exit hooks to reap language-server subprocesses.
 *
 * @param {{timeoutMs?:number,killFirst?:boolean,log?:(line:string)=>void}} [options]
 * @returns {Promise<{status:'ok'|'failed'|'timed_out',total:number,rejected:number,timedOut:boolean,timeoutMs:number,failures:Array<unknown>}>}
 */
export const drainLspSessionPool = async (options = {}) => {
  if (drainSessionPoolPromise) return drainSessionPoolPromise;
  const timeoutMs = toPositiveInt(options?.timeoutMs, DEFAULT_DRAIN_TIMEOUT_MS, 100);
  const killFirst = options?.killFirst !== false;
  const log = typeof options?.log === 'function' ? options.log : null;
  const disposalFailuresBeforeDrain = sessionPoolMetrics.disposalFailures;
  drainSessionPoolPromise = (async () => {
    clearCleanupTimer();
    await cleanupPassQueue.catch(() => {});
    const liveSessions = [...new Set([...sessions.values(), ...unconfirmedDisposals.values()])];
    sessions.clear();
    const disposalPromises = liveSessions.map((session) => enqueueSessionDisposal(session, { killFirst }));
    const pendingDisposals = Array.from(disposalBarriers.values());
    const pendingTrackedDisposals = Array.from(activeDisposals.values());
    const waited = await waitForAllSettledWithTimeout(
      [...new Set([...disposalPromises, ...pendingDisposals, ...pendingTrackedDisposals])],
      timeoutMs
    );
    if (waited.timedOut) {
      const hardKillFailures = hardKillSessionsSync(liveSessions);
      if (log) {
        emitPoolWarning(log,
          `[tooling:lsp] session pool drain timed out after ${timeoutMs}ms; `
          + `attempted hard kill for ${liveSessions.length} session(s); exit remains unconfirmed.`
        );
      }
      return {
        status: 'timed_out',
        total: liveSessions.length,
        rejected: 0,
        timedOut: true,
        timeoutMs,
        failures: Object.freeze([waited.error, ...hardKillFailures])
      };
    }
    // Retain the exact original rejection values already admitted by this
    // bounded wait. Counts and warning callbacks cannot replace their causes.
    const failures = Object.freeze(waited.settled.filter((entry) => entry?.status === 'rejected').map(entry => entry.reason));
    const rejected = failures.length;
    if (!rejected && sessionPoolMetrics.disposalFailures === disposalFailuresBeforeDrain) {
      retireUnusedHealthySessionRecords();
    }
    if (log) {
      emitPoolWarning(log,
        `[tooling:lsp] session pool drain complete: sessions=${liveSessions.length}, `
        + `rejected=${rejected}, timeoutMs=${timeoutMs}.`
      );
    }
    return {
      status: rejected ? 'failed' : 'ok',
      total: liveSessions.length,
      rejected,
      timedOut: false,
      timeoutMs,
      failures
    };
  })();
  try {
    return await drainSessionPoolPromise;
  } finally {
    drainSessionPoolPromise = null;
  }
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
 *   sessionPoolMaxEntries?:number|null,
 *   initializationOptions?:object|null,
 *   abortSignal?:AbortSignal|null
 * }} options
 * @param {(lease:{
 *   client:Awaited<ReturnType<typeof createRetainedLspClient>>,
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
const withLspSessionRun = async (options, fn, owner) => {
  throwIfAborted(options?.abortSignal);
  const enabled = options?.enabled !== false;
  if (!enabled) {
    const singleSession = await createSession({
      ...options,
      providerId: options?.providerId || options?.cmd || 'lsp',
      workspaceKey: options?.workspaceKey || options?.repoRoot || options?.cwd || ''
    });
    try {
      retainRunSession(singleSession, owner, () => nativeDisposalBySession.get(singleSession)
        || disposeSessionClient(singleSession));
      owner?.assertAccepting();
      throwIfAborted(options?.abortSignal);
      return await fn({
        client: singleSession.client,
        materializationSession: singleSession.materializations,
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

  const { resolved, barrier } = await acquireSessionTurn({
    ...options,
    providerId: options?.providerId || options?.cmd || 'lsp',
    workspaceKey: options?.workspaceKey || options?.repoRoot || options?.cwd || '',
    args: normalizeArgs(options?.args),
    sessionPoolMaxEntries: options?.sessionPoolMaxEntries
  }, owner);
  const session = resolved.session;
  try {
    owner?.assertAccepting();
    throwIfAborted(options?.abortSignal);
  }
  catch (error) { sessionPoolMetrics.admissionCancelled += 1; barrier.resolve(); throw error; }
  refreshSessionState(session);
  if (sessions.get(session.key) !== session || session.disposed || session.state === SESSION_STATE.RETIRED) {
    barrier.resolve();
    throw new Error('LSP session became unavailable before lease acquisition.');
  }
  if (session.state === SESSION_STATE.POISONED) {
    barrier.resolve();
    throw new Error(`LSP session is poisoned (${session.poisonReason || 'unknown'}).`);
  }
  session.activeCount += 1;
  session.healthRecord.activeLeaseCount += 1;
  session.lastUsedAt = Date.now();
  if (resolved.reused) session.reuseCount += 1;
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
  const leaseMarkPoisoned = (reason = 'unknown') => {
    markSessionPoisoned(session, reason);
  };
  const leaseMarkInitialized = (initializeResult = null) => {
    markSessionReady(session, initializeResult);
  };
  const leaseMarkInitializing = () => {
    markSessionInitializing(session);
  };
  let fnSucceeded = false;
  try {
    const result = await fn({
      client: session.client,
      materializationSession: session.materializations,
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
      getReliabilityState: () => ({
        ...(session.lifecycleHealth?.getState ? session.lifecycleHealth.getState() : {}),
        quarantine: resolveQuarantineState(session.healthRecord)
      }),
      markInitializing: leaseMarkInitializing,
      markInitialized: leaseMarkInitialized,
      markPoisoned: leaseMarkPoisoned
    });
    fnSucceeded = true;
    return result;
  } finally {
    session.handlers.onNotification = null;
    session.handlers.onRequest = null;
    session.handlers.stderrFilter = null;
    session.handlers.onStderrLine = null;
    let disposalPromise = null;
    session.activeCount = Math.max(0, session.activeCount - 1);
    session.healthRecord.activeLeaseCount = Math.max(0, session.healthRecord.activeLeaseCount - 1);
    session.lastUsedAt = Date.now();
    if (fnSucceeded && session.healthRecord?.recoveryProbeActive === true && session.state !== SESSION_STATE.POISONED) {
      completeRecoveryProbe(session.healthRecord, true);
    }
    refreshSessionState(session);
    const activeSession = sessions.get(session.key);
    if (activeSession !== session && session.activeCount === 0) {
      session.recycleCount += 1;
      disposalPromise = enqueueSessionDisposal(session, { killFirst: true });
    } else if (session.state === SESSION_STATE.POISONED && session.activeCount === 0) {
      session.recycleCount += 1;
      sessions.delete(session.key);
      disposalPromise = enqueueSessionDisposal(session, { killFirst: true });
    } else if (shouldExpireForLifetime(session) && session.activeCount === 0 && session.queuedTurns <= 1) {
      session.recycleCount += 1;
      sessions.delete(session.key);
      disposalPromise = enqueueSessionDisposal(session, { killFirst: true });
    }
    barrier.resolve();
    if (disposalPromise) {
      void disposalPromise.catch((error) => {
        emitPoolWarning(
          session?.options?.log,
          `[tooling:lsp] lease-finalizer disposal failed for ${session?.lifecycleName || session?.key || 'session'}: ` +
          `${describePoolFailure(error)}`
        );
      });
    }
  }
};

/**
 * Test-only hooks for deterministic session-pool assertions.
 */
export const withLspSession = (options, fn) => {
  const owner = currentRunResourceScope();
  return owner ? owner.track(() => withLspSessionRun(options, fn, owner)) : withLspSessionRun(options, fn, null);
};

export const __testLspSessionPool = {
  killAllNow() {
    killAllSessionsNow();
  },
  async drain(options = {}) {
    return await drainLspSessionPool(options);
  },
  async reset() {
    const live = Array.from(sessions.values());
    killAllSessionsNow();
    sessionHealthRecords.clear();
    for (const session of live) {
      await disposeSessionClient(session);
    }
    drainSessionPoolPromise = null;
    activeDisposals.clear();
    testHooks.disposeDelayMs = 0;
    testHooks.shortQuarantineMs = null;
    testHooks.extendedQuarantineMs = null;
    cleanupPassQueue = Promise.resolve();
    sessionPoolMetrics.cleanupPassFailures = 0;
    sessionPoolMetrics.disposalFailures = 0;
    sessionPoolMetrics.creationBarrierFailures = 0;
    sessionPoolMetrics.queueBarrierFailures = 0;
    sessionPoolMetrics.maxSessionEvictions = 0;
    sessionPoolMetrics.admissionWaiters = 0;
    sessionPoolMetrics.leaseQueueWaiters = 0;
    sessionPoolMetrics.admissionHighWater = 0;
    sessionPoolMetrics.admissionWaitMs = 0;
    sessionPoolMetrics.admissionCancelled = 0;
  },
  getSize() {
    return sessions.size;
  },
  setDisposeDelayMs(value) {
    testHooks.disposeDelayMs = toNonNegativeInt(value, 0);
  },
  setQuarantineDurations({ shortMs = null, extendedMs = null } = {}) {
    testHooks.shortQuarantineMs = shortMs == null ? null : toPositiveInt(shortMs, LSP_SHORT_QUARANTINE_MS, 100);
    testHooks.extendedQuarantineMs = extendedMs == null ? null : toPositiveInt(extendedMs, LSP_EXTENDED_QUARANTINE_MS, 100);
  },
  getPendingDisposals() {
    return disposalBarriers.size;
  },
  getHealthRecordCount() {
    return sessionHealthRecords.size;
  },
  getMetrics() {
    return {
      cleanupPassFailures: Number(sessionPoolMetrics.cleanupPassFailures) || 0,
      disposalFailures: Number(sessionPoolMetrics.disposalFailures) || 0,
      creationBarrierFailures: Number(sessionPoolMetrics.creationBarrierFailures) || 0,
      queueBarrierFailures: Number(sessionPoolMetrics.queueBarrierFailures) || 0,
      maxSessionEvictions: Number(sessionPoolMetrics.maxSessionEvictions) || 0,
      admissionWaiters: sessionPoolMetrics.admissionWaiters,
      leaseQueueWaiters: sessionPoolMetrics.leaseQueueWaiters,
      admissionHighWater: sessionPoolMetrics.admissionHighWater,
      admissionWaitMs: sessionPoolMetrics.admissionWaitMs,
      admissionCancelled: sessionPoolMetrics.admissionCancelled
    };
  },
  getHealthStateForKey(key) {
    return resolveQuarantineState(sessionHealthRecords.get(String(key || '')));
  }
};
