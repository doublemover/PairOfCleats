import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { redactDiagnosticText } from '../diagnostic-text.js';
import { observeRuntimeProcess } from './observe.js';
import { sanitizeNodeStartupOptions } from '../workers/node-argv.js';

export const RUNTIME_RECEIPT_VERSION = 1;
export const RUNTIME_ATTEMPT_LIMIT = 16;
export const RUNTIME_ATTEMPT_MAX_BYTES = 48 * 1024;
const SECRET_KEY = /(?:password|passwd|passphrase|secret|credential|authorization|api[_-]?key|api[_-]?token|access[_-]?token|refresh[_-]?token|^token$|^cookie$)/iu;
const RAW_KEY = /^(?:argv|rawArgv|env|environment|toolingEnv|configContents)$/u;
const TERMINAL = new Set(['succeeded', 'failed', 'aborted']);

/** Bound before persistence, including free text and objects outside logger redaction. */
export const sanitizeRuntimeReceipt = (value, depth = 0, seen = new Set()) => {
  if (value == null || typeof value === 'boolean') return value ?? null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return redactDiagnosticText(value, 2048);
  if (typeof value !== 'object' || depth > 10 || seen.has(value)) return null;
  seen.add(value);
  const result = Array.isArray(value) ? [] : {};
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 64)) result.push(sanitizeRuntimeReceipt(entry, depth + 1, seen));
  } else {
    for (const [key, entry] of Object.entries(value).slice(0, 64)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      const safeKey = key.slice(0, 128);
      if (SECRET_KEY.test(key) || RAW_KEY.test(key)) result[safeKey] = { redacted: true };
      else if (key === 'execArgv') result[safeKey] = sanitizeNodeStartupOptions({ execArgv: Array.isArray(entry) ? entry : [] }).execArgv;
      else if (key === 'nodeOptions' && typeof entry === 'string') result[safeKey] = sanitizeNodeStartupOptions({ nodeOptions: entry }).nodeOptions;
      else if (key === 'nodeOptions' && entry && !Array.isArray(entry) && typeof entry === 'object') {
        result[safeKey] = sanitizeRuntimeReceipt(entry, depth + 1, seen);
        for (const label of ['requested', 'planned', 'effective']) {
          if (result[safeKey]?.[label] && typeof entry[label]?.value === 'string') {
            result[safeKey][label].value = sanitizeNodeStartupOptions({ nodeOptions: entry[label].value }).nodeOptions.join(' ');
            result[safeKey][label].redacted = true;
          }
        }
      } else result[safeKey] = sanitizeRuntimeReceipt(entry, depth + 1, seen);
    }
  }
  seen.delete(value);
  return result;
};

/** Compact admission-owner facts; scheduler trace rings stay in their existing owner. */
export const projectRuntimeScheduler = (stats) => {
  if (!stats) return null;
  const select = (value, keys) => Object.fromEntries(keys.filter((key) => value?.[key] !== undefined).map((key) => [key, value[key]]));
  const queues = Object.entries(stats.queues || {});
  const surfaces = Object.entries(stats.adaptive?.surfaces || {});
  return sanitizeRuntimeReceipt({
    observedAt: new Date().toISOString(), tokens: stats.tokens, activity: stats.activity,
    counters: stats.counters, utilization: stats.utilization,
    queues: Object.fromEntries(queues.slice(0, 16).map(([name, queue]) => [name, select(queue, [
      'surface', 'running', 'pending', 'runnable', 'blocked', 'pendingBytes', 'inFlightBytes',
      'maxPending', 'maxPendingBytes', 'maxInFlightBytes', 'completed', 'failed', 'rejected'
    ])])), queuesTruncated: queues.length > 16,
    adaptive: { ...select(stats.adaptive, ['enabled', 'baseline', 'max', 'mode', 'memoryReserveMb', 'memoryPerTokenMb', 'maxInFlightBytes']),
      surfaces: Object.fromEntries(surfaces.slice(0, 8).map(([name, surface]) => [name, select(surface, ['minConcurrency', 'maxConcurrency', 'currentConcurrency', 'lastAction'])])),
      surfacesTruncated: surfaces.length > 8 },
    traceIncluded: false
  });
};

/** Preserve selected lexical paths separately from filesystem observations. */
export const observeRuntimePath = async (selected, { source = 'runtime-selection', io = fs, platform = process.platform } = {}) => {
  if (typeof selected !== 'string' || !selected.trim()) return null;
  const foreignWindows = platform !== 'win32' && path.win32.isAbsolute(selected) && !path.posix.isAbsolute(selected);
  const absolute = foreignWindows ? path.win32.normalize(selected) : path.resolve(selected);
  const result = { selected, absolute, canonical: null, source, observedAt: new Date().toISOString(), state: 'unknown', errorCode: null, observationMethod: 'stat-and-realpath' };
  if (foreignWindows) return { ...result, observationMethod: 'unavailable-foreign-platform' };
  try {
    await io.stat(absolute);
    result.state = 'exists';
    try {
      result.canonical = await io.realpath(absolute);
      result.canonicalMethod = platform === 'win32' ? 'node-fs-realpath-handle-final-path' : 'node-fs-realpath';
      result.writerHandleObserved = false;
    }
    catch (error) { result.errorCode = String(error.code || 'UNKNOWN'); }
  } catch (error) {
    result.errorCode = String(error.code || 'UNKNOWN');
    result.state = error.code === 'ENOENT' ? 'missing' : ['EACCES', 'EPERM'].includes(error.code) ? 'inaccessible' : 'unknown';
  }
  // Missing paths can still have a redirected existing ancestor. This is path
  // resolution only, and must not be upgraded into an existence observation.
  if (!result.canonical && result.state === 'missing') {
    let ancestor = path.dirname(absolute);
    for (let i = 0; i < 64; i += 1) {
      try {
        const canonicalAncestor = await io.realpath(ancestor);
        result.canonical = path.join(canonicalAncestor, path.relative(ancestor, absolute));
        result.canonicalMethod = 'existing-ancestor';
        break;
      } catch (error) {
        if (error.code !== 'ENOENT') break;
        const next = path.dirname(ancestor);
        if (next === ancestor) break;
        ancestor = next;
      }
    }
  }
  return result;
};

const projectEnvelope = (envelope) => {
  if (!envelope) return null;
  const settings = {};
  for (const name of ['maxOldSpaceMb', 'uvThreadpoolSize']) {
    const value = envelope.runtime?.[name];
    if (value) settings[name] = value;
  }
  const nodeOptions = envelope.runtime?.nodeOptions;
  if (nodeOptions) settings.nodeOptions = {
    requested: { ...nodeOptions.requested, value: sanitizeNodeStartupOptions({ nodeOptions: nodeOptions.requested?.value }).nodeOptions },
    planned: { ...nodeOptions.planned, value: sanitizeNodeStartupOptions({ nodeOptions: nodeOptions.planned?.value }).nodeOptions },
    application: nodeOptions.application || 'launch-plan',
    redacted: true
  };
  return { evidenceScope: envelope.evidenceScope, settings, concurrency: envelope.concurrency, queues: envelope.queues, warnings: envelope.warnings };
};

export const boundRuntimeAttempt = (attempt) => {
  const safe = sanitizeRuntimeReceipt(attempt);
  if (Buffer.byteLength(JSON.stringify(safe)) > RUNTIME_ATTEMPT_MAX_BYTES) {
    const error = new Error('Runtime attempt exceeds bounded receipt size.');
    error.code = 'ERR_RUNTIME_RECEIPT_SIZE';
    throw error;
  }
  return safe;
};

export const createRuntimeAttempt = async ({
  buildId, stage = null, mode = null, parentAttemptId = null, observability = null,
  envelope = null, paths = {}, inputs = {}, embeddings = null, executionClass = 'in-process', toolVersion = null
} = {}) => {
  const pathObservations = {};
  for (const [name, value] of Object.entries(paths).slice(0, 16)) {
    pathObservations[name] = await observeRuntimePath(typeof value === 'string' ? value : value?.selected, { source: value?.source });
  }
  const observation = observeRuntimeProcess();
  const now = new Date().toISOString();
  return boundRuntimeAttempt({
    runtimeReceiptVersion: RUNTIME_RECEIPT_VERSION,
    attemptId: crypto.randomUUID(), buildId: String(buildId || 'unknown'),
    parentAttemptId: parentAttemptId || observability?.context?.runtimeAttemptId || null,
    correlationId: observability?.correlation?.correlationId || null,
    stage, mode, executionClass, startedAt: now, updatedAt: now, finishedAt: null,
    lifecycle: 'resolved',
    producer: { toolVersion, toolSourceRevision: null, processInstanceId: observation.processInstanceId },
    inputs, paths: pathObservations,
    runtime: { plan: projectEnvelope(envelope), observed: observation, workers: null, scheduler: null },
    embeddings: embeddings || { observation: { state: 'unknown', provider: null, dims: null, observedAt: null } },
    persistence: { status: 'pending', lastErrorCode: null }
  });
};

export const patchRuntimeAttempt = (attempt, patch = {}) => {
  const now = new Date().toISOString();
  const lifecycle = patch.lifecycle || attempt.lifecycle;
  return boundRuntimeAttempt({
    ...attempt, ...patch, attemptId: attempt.attemptId, buildId: attempt.buildId,
    startedAt: attempt.startedAt, updatedAt: now,
    finishedAt: TERMINAL.has(lifecycle) ? (attempt.finishedAt || now) : null,
    runtime: { ...attempt.runtime, ...patch.runtime },
    paths: { ...attempt.paths, ...patch.paths },
    inputs: { ...attempt.inputs, ...patch.inputs },
    embeddings: { ...attempt.embeddings, ...patch.embeddings }
  });
};

export const mergeRuntimeAttempts = (base, patch) => {
  const attempts = new Map((base?.attempts || []).map((attempt) => [attempt.attemptId, attempt]));
  for (const attempt of patch?.attempts || []) attempts.set(attempt.attemptId, boundRuntimeAttempt(attempt));
  const ordered = Array.from(attempts.values()).sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  return {
    schemaVersion: RUNTIME_RECEIPT_VERSION,
    latestAttemptId: patch?.latestAttemptId || base?.latestAttemptId || null,
    prunedAttemptCount: (base?.prunedAttemptCount || 0) + Math.max(0, ordered.length - RUNTIME_ATTEMPT_LIMIT),
    attempts: ordered.slice(-RUNTIME_ATTEMPT_LIMIT)
  };
};

export const collectRuntimeAttemptEvents = (runtime) => (runtime?.attempts || []).map((attempt) => ({
  type: 'runtime-attempt', at: attempt.updatedAt, attemptId: attempt.attemptId,
  parentAttemptId: attempt.parentAttemptId, buildId: attempt.buildId,
  stage: attempt.stage, mode: attempt.mode, lifecycle: attempt.lifecycle,
  embeddingObservationState: attempt.embeddings?.observation?.state || 'unknown'
}));
