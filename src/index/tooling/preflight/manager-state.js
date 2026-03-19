import crypto from 'node:crypto';
import { normalizeProviderId } from '../provider-contract.js';
import {
  TOOLING_PREFLIGHT_REASON_CODES,
  TOOLING_PREFLIGHT_STATES,
  buildToolingPreflightDiagnostic,
  isValidToolingPreflightTransition
} from './contract.js';
import { PREFLIGHT_CLASS } from './manager-config.js';

export const TOOLING_PREFLIGHT_STATE = Symbol.for('poc.tooling.preflight.state');

const DEFAULT_PREFLIGHT_MAX_CONCURRENCY = 4;

const normalizeOwnershipSegment = (value, fallback) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || fallback;
};

export const resolvePreflightOwnershipId = ({ providerId, preflightId, key }) => {
  const providerSegment = normalizeOwnershipSegment(providerId, 'provider');
  const preflightSegment = normalizeOwnershipSegment(preflightId, 'preflight');
  const hash = crypto
    .createHash('sha1')
    .update(String(key || `${providerSegment}:${preflightSegment}`))
    .digest('hex')
    .slice(0, 12);
  return `tooling-preflight:${providerSegment}:${preflightSegment}:${hash}`;
};

const createSchedulerMetrics = () => ({
  scheduled: 0,
  queued: 0,
  dequeued: 0,
  started: 0,
  completed: 0,
  timedOut: 0,
  failed: 0,
  queueDepthPeak: 0,
  runningPeak: 0,
  queueWaitMsTotal: 0,
  queueWaitMsMax: 0,
  queueWaitSamples: 0,
  byClass: {
    [PREFLIGHT_CLASS.PROBE]: {
      scheduled: 0,
      queued: 0,
      dequeued: 0,
      started: 0,
      completed: 0,
      timedOut: 0,
      failed: 0
    },
    [PREFLIGHT_CLASS.WORKSPACE]: {
      scheduled: 0,
      queued: 0,
      dequeued: 0,
      started: 0,
      completed: 0,
      timedOut: 0,
      failed: 0
    },
    [PREFLIGHT_CLASS.DEPENDENCY]: {
      scheduled: 0,
      queued: 0,
      dequeued: 0,
      started: 0,
      completed: 0,
      timedOut: 0,
      failed: 0
    }
  }
});

const createState = () => ({
  inFlight: new Map(),
  completed: new Map(),
  snapshots: new Map(),
  scheduler: {
    queue: [],
    running: 0,
    maxConcurrency: DEFAULT_PREFLIGHT_MAX_CONCURRENCY,
    accepting: true,
    metrics: createSchedulerMetrics()
  }
});

export const resolveState = (ctx) => {
  if (!ctx || typeof ctx !== 'object') return createState();
  if (!Object.prototype.hasOwnProperty.call(ctx, TOOLING_PREFLIGHT_STATE)) {
    Object.defineProperty(ctx, TOOLING_PREFLIGHT_STATE, {
      value: createState(),
      enumerable: false,
      configurable: false,
      writable: false
    });
  }
  return ctx[TOOLING_PREFLIGHT_STATE];
};

export const resolvePreflightId = (provider) => {
  const value = provider?.preflightId;
  if (typeof value === 'string' && value.trim()) return value.trim();
  return `${normalizeProviderId(provider?.id) || 'provider'}.preflight`;
};

export const resolvePreflightKey = ({ provider, ctx, inputs }) => {
  const providerId = normalizeProviderId(provider?.id) || 'provider';
  const preflightId = resolvePreflightId(provider);
  const root = String(ctx?.repoRoot || '');
  const buildRoot = String(ctx?.buildRoot || '');
  const configHash = typeof provider?.getConfigHash === 'function'
    ? String(provider.getConfigHash(ctx) || '')
    : '';
  let customKey = '';
  if (typeof provider?.getPreflightKey === 'function') {
    customKey = String(provider.getPreflightKey(ctx, inputs) || '');
  }
  return `${providerId}::${preflightId}::${root}::${buildRoot}::${configHash}::${customKey}`;
};

export const resolveLogger = (ctx) => (
  typeof ctx?.logger === 'function'
    ? ctx.logger
    : () => {}
);

export const describeProvider = (provider) => (
  normalizeProviderId(provider?.id) || String(provider?.id || 'provider')
);

export const createWaveToken = () => (
  `wave-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
);

export const cloneSnapshot = (snapshot) => (
  snapshot && typeof snapshot === 'object'
    ? {
      ...snapshot,
      diagnostic: snapshot.diagnostic && typeof snapshot.diagnostic === 'object'
        ? { ...snapshot.diagnostic }
        : null
    }
    : null
);

export const setSnapshot = (state, key, payload = {}) => {
  const prior = state.snapshots.get(key);
  const fromState = prior?.state || TOOLING_PREFLIGHT_STATES.IDLE;
  const nextState = payload?.state || prior?.state || TOOLING_PREFLIGHT_STATES.IDLE;
  if (!isValidToolingPreflightTransition(fromState, nextState) && fromState !== nextState) {
    return prior || null;
  }
  const next = {
    ...prior,
    ...payload,
    state: nextState,
    providerId: String(payload?.providerId || prior?.providerId || ''),
    preflightId: String(payload?.preflightId || prior?.preflightId || ''),
    key
  };
  const startedAtMs = Number.isFinite(next?.startedAtMs) ? next.startedAtMs : null;
  const finishedAtMs = Number.isFinite(next?.finishedAtMs) ? next.finishedAtMs : null;
  const durationMs = (
    Number.isFinite(next?.durationMs)
      ? next.durationMs
      : (Number.isFinite(startedAtMs) && Number.isFinite(finishedAtMs)
        ? Math.max(0, finishedAtMs - startedAtMs)
        : null)
  );
  next.diagnostic = buildToolingPreflightDiagnostic({
    providerId: next.providerId,
    preflightId: next.preflightId,
    state: next.state,
    reasonCode: next.reasonCode,
    message: next.message,
    durationMs,
    timedOut: next.timedOut === true,
    cached: next.cached === true,
    startedAtMs,
    finishedAtMs
  });
  state.snapshots.set(key, next);
  return next;
};

export const resolveSnapshotForKey = (state, key) => {
  const snapshot = state.snapshots.get(key);
  if (snapshot) return cloneSnapshot(snapshot);
  return null;
};

const isAbortSignalLike = (signal) => (
  Boolean(signal)
  && typeof signal.aborted === 'boolean'
  && typeof signal.addEventListener === 'function'
  && typeof signal.removeEventListener === 'function'
);

export const resolveRequestedAbortSignal = (ctx, inputs) => {
  if (isAbortSignalLike(inputs?.abortSignal)) return inputs.abortSignal;
  if (isAbortSignalLike(ctx?.abortSignal)) return ctx.abortSignal;
  return null;
};

export const createManagedAbortBridge = (upstreamSignal) => {
  if (typeof AbortController !== 'function') {
    return {
      signal: upstreamSignal || null,
      cleanup: () => {},
      abort: () => {}
    };
  }
  const controller = new AbortController();
  let detached = false;
  const abortFromUpstream = () => {
    if (controller.signal.aborted) return;
    try {
      controller.abort(upstreamSignal?.reason);
    } catch {
      controller.abort();
    }
  };
  if (isAbortSignalLike(upstreamSignal)) {
    if (upstreamSignal.aborted) {
      abortFromUpstream();
    } else {
      upstreamSignal.addEventListener('abort', abortFromUpstream, { once: true });
    }
  }
  const cleanup = () => {
    if (detached) return;
    detached = true;
    if (isAbortSignalLike(upstreamSignal)) {
      upstreamSignal.removeEventListener('abort', abortFromUpstream);
    }
  };
  const abort = (reason) => {
    if (!controller.signal.aborted) {
      try {
        controller.abort(reason);
      } catch {
        controller.abort();
      }
    }
    cleanup();
  };
  return {
    signal: controller.signal,
    cleanup,
    abort
  };
};
