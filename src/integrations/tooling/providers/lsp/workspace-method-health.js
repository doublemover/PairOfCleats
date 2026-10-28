import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { withFileLock } from '../../../../shared/locks/file-lock.js';
import { readVerifiedContainedFile } from '../../../../shared/contained-file.js';
import { assertToolingCachePath, writeToolingCacheJson } from '../../../../index/tooling/cache-storage.js';
import { observeStorageResource, describeStorageFailure } from '../../../../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../../shared/storage/operation-error.js';
import { isAbortError, throwIfAborted } from '../../../../shared/abort.js';
import { observeWorkspaceHealthIdentity } from './workspace-health-identity.js';
import { retainWorkspaceHealthDecision } from './workspace-health-decision.js';
import { LSP_SHORT_QUARANTINE_MS, LSP_EXTENDED_QUARANTINE_MS } from './health-policy.js';

const VERSION = 1, MAX_BYTES = 256 * 1024, MAX_VARIANTS = 8;
const METHODS = new Set(['initialize', 'documentSymbol', 'hover', 'semanticTokens', 'signatureHelp', 'inlayHints',
  'definition', 'typeDefinition', 'references', 'prepareCallHierarchy', 'incomingCalls', 'outgoingCalls',
  'prepareTypeHierarchy', 'supertypes', 'subtypes']);
const CLASSES = new Set(['timeout', 'transport', 'malformed']);
const COOLDOWN = Object.freeze({ timeout: LSP_SHORT_QUARANTINE_MS, transport: LSP_EXTENDED_QUARANTINE_MS, malformed: LSP_EXTENDED_QUARANTINE_MS });
const exactTime = value => Number.isSafeInteger(value) && value >= 0;
const digest = value => createHash('sha256').update(value).digest('hex');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message) => Object.assign(new Error(message), { code });

const failureClass = error => {
  const observation = observeStorageResource(error, { phase: 'workspace-health-request-classification' });
  observation.requireSettled();
  let classification = null, methodScoped = false;
  try {
    if (isAbortError(error)) { observation.requireSettled(); return null; }
    const { code, message } = describeStorageFailure(error, { phase: 'workspace-health-request-diagnostics' });
    if (code === 'ERR_LSP_TRANSPORT_CLOSED' || /transport closed|writer unavailable|lsp exited/iu.test(message)) classification = 'transport';
    else if (code === 'ERR_LSP_REQUEST_TIMEOUT' || /request timeout/iu.test(message)) { classification = 'timeout'; methodScoped = true; }
    else if (code === 'ERR_TOOLING_LSP_INVALID_INITIALIZE_RESULT' || code === 'ERR_LSP_HEALTH_MALFORMED_RESPONSE'
      || /PROTOCOL|INVALID_RESPONSE|PARSE/iu.test(code)) {
      classification = 'malformed'; methodScoped = code === 'ERR_LSP_HEALTH_MALFORMED_RESPONSE';
    }
  } catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
  observation.requireSettled(); return classification ? Object.freeze({ failureClass: classification, methodScoped }) : null;
};
const validResponse = (method, result) => {
  if (method === 'initialize') return Boolean(object(result));
  if (result === null) return true;
  if (method === 'hover') return Boolean(object(result) && (typeof result.contents === 'string'
    || Array.isArray(result.contents) || object(result.contents)));
  if (method === 'semanticTokens') return Boolean(object(result) && Array.isArray(result.data));
  if (method === 'signatureHelp') return Boolean(object(result) && Array.isArray(result.signatures));
  if (['definition', 'typeDefinition'].includes(method)) return Array.isArray(result) || Boolean(object(result) && typeof result.uri === 'string');
  return Array.isArray(result);
};
const validStore = (value, scopeKey) => object(value) && value.schemaVersion === VERSION
  && value.kind === 'lsp-workspace-method-health' && value.scopeKey === scopeKey && object(value.variants)
  && Object.keys(value.variants).length <= MAX_VARIANTS && Object.entries(value.variants).every(([fingerprint, variant]) =>
  /^[a-f0-9]{64}$/u.test(fingerprint) && object(variant) && exactTime(variant.updatedAt) && object(variant.methods)
    && Object.keys(variant.methods).length <= METHODS.size && Object.entries(variant.methods).every(([method, state]) =>
    METHODS.has(method) && object(state) && CLASSES.has(state.failureClass) && exactTime(state.updatedAt)
      && Number.isSafeInteger(state.failures) && state.failures > 0 && exactTime(state.cooldownUntil)
      && state.cooldownUntil <= state.updatedAt + COOLDOWN[state.failureClass]));

/** Shared bounded advisory health. It neither reuses provider/request output
 * nor grants installation, native-close or cache-deletion authority. */
export const createWorkspaceMethodHealth = async ({ cacheRoot, now = Date.now, timeoutThreshold = 3, ...identityInputs }) => {
  if (typeof now !== 'function' || ![1, 3].includes(timeoutThreshold)) throw new TypeError('Invalid internal method-health policy.');
  const clock = () => { const value = now(); if (!exactTime(value)) throw new TypeError('Method health needs a finite observed clock.'); return value; };
  const identity = typeof cacheRoot === 'string' && cacheRoot ? await observeWorkspaceHealthIdentity({ ...identityInputs,
    policy: { ...identityInputs.policy, workspaceMethodHealth: { version: VERSION, timeoutThreshold, cooldown: COOLDOWN } } })
    : { fingerprint: null, reason: 'health-cache-unselected' };
  const metric = { identityScope: identity.identityScope || null, identityState: identity.reason || 'observed',
    persistedState: 'disabled', freshAttempts: 0, suppressedRequests: 0, recoveryProbes: 0, withheldRetryAllowance: 0,
    byMethod: Object.create(null), publishedWrites: 0, persistenceFailures: 0, preAdmissionMethods: [] };
  const filename = identity.fingerprint && typeof cacheRoot === 'string' && cacheRoot
    ? assertToolingCachePath(path.join(cacheRoot, 'lsp', 'workspace-health', identity.scopeKey + '.json')) : null;
  const empty = () => ({ schemaVersion: VERSION, kind: 'lsp-workspace-method-health', scopeKey: identity.scopeKey, variants: {} });
  const read = async () => {
    if (!filename) return { state: 'disabled', value: empty() };
    try {
      const observed = await readVerifiedContainedFile(path.dirname(filename), filename, { maxBytes: MAX_BYTES, signal: identityInputs.signal });
      if (observed.stat.nlink !== 1) return { state: 'unavailable', value: null };
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(observed.buffer));
      if (!validStore(value, identity.scopeKey)) return { state: 'unavailable', value: null };
      const current = value.variants[identity.fingerprint];
      if (current?.updatedAt > clock()) return { state: 'unavailable', value: null };
      return { state: 'loaded', value };
    } catch (error) {
      const diagnostic = describeStorageFailure(error, { phase: 'workspace-health-read' });
      const original = observeStorageResource(error, { phase: 'workspace-health-read-classification' });
      try { if (isAbortError(error)) throw error; }
      catch (inspection) { if (inspection === error) throw error; throw original.retain(inspection, { inspectionPresent: true }); }
      original.requireSettled();
      return { state: diagnostic.code === 'ENOENT' ? 'missing' : 'unavailable', value: diagnostic.code === 'ENOENT' ? empty() : null };
    }
  };
  let stored = await read(), methods = { ...(stored.value?.variants[identity.fingerprint]?.methods || {}) };
  metric.persistedState = stored.state;
  const bucket = method => metric.byMethod[method] ||= { freshAttempts: 0, suppressedRequests: 0, recoveryProbes: 0,
    lastFailureClass: methods[method]?.failureClass || null, reusedHealth: Boolean(methods[method]) };
  const update = async (method, classification) => {
    const mutate = value => {
      const at = clock(), variant = value.variants[identity.fingerprint] || { updatedAt: at, methods: {} };
      const previous = variant.methods[method];
      if (!classification) delete variant.methods[method];
      else {
        const count = previous?.failureClass === classification ? previous.failures + 1 : 1;
        if (!Number.isSafeInteger(count)) throw fail('ERR_LSP_HEALTH_COUNTER', 'Method-health failure count exceeds exact accounting.');
        variant.methods[method] = { failureClass: classification, failures: count, updatedAt: at,
          cooldownUntil: count >= (classification === 'timeout' ? timeoutThreshold : 1) ? at + COOLDOWN[classification] : 0 };
      }
      variant.updatedAt = at; value.variants[identity.fingerprint] = variant;
      const keys = Object.keys(value.variants).filter(key => key !== identity.fingerprint)
        .sort((a, b) => value.variants[b].updatedAt - value.variants[a].updatedAt || a.localeCompare(b));
      for (const key of keys.slice(MAX_VARIANTS - 1)) delete value.variants[key];
      return { ...variant.methods };
    };
    if (!filename || stored.state === 'unavailable') {
      const value = empty(); value.variants[identity.fingerprint] = { updatedAt: clock(), methods: { ...methods } };
      methods = mutate(value); return;
    }
    let entered = false;
    await withFileLock({ lockPath: filename + '.writer.lock', waitMs: 5000, signal: identityInputs.signal,
      staleMs: Number.MAX_SAFE_INTEGER, metadata: { scope: 'lsp-workspace-health-write', hostname: os.hostname(), resourceSettlementVersion: 1 } }, async () => {
      entered = true; const latest = await read();
      if (!latest.value) { stored = latest; const value = empty(); value.variants[identity.fingerprint] = { updatedAt: clock(), methods: { ...methods } }; methods = mutate(value); return; }
      const next = mutate(latest.value);
      if (Buffer.byteLength(JSON.stringify(latest.value)) > MAX_BYTES) throw fail('ERR_LSP_HEALTH_BYTES', 'Method-health receipt exceeds its fixed allowance.');
      await writeToolingCacheJson(filename, latest.value); methods = next; stored = { state: 'loaded', value: latest.value };
      metric.publishedWrites++; metric.persistedState = 'loaded';
    });
    if (!entered) throw fail('ERR_LSP_HEALTH_BUSY', 'Method-health persistence ownership is unavailable.');
  };
  const deferred = method => {
    metric.suppressedRequests++; bucket(method).suppressedRequests++;
    return retainWorkspaceHealthDecision(fail('TOOLING_METHOD_COOLDOWN', `Known ${method} workspace health defers this request.`), { kind: 'not-admitted', method });
  };
  const execute = async (method, operation, { recovery = false, retriesRemaining = 0 } = {}) => {
    throwIfAborted(identityInputs.signal);
    metric.freshAttempts++; bucket(method).freshAttempts++;
    let result, prerequisite = null, accepted = false;
    try {
      result = await operation();
      const original = observeStorageResource(result, { phase: 'workspace-health-original-result' });
      if (original.hasResourceObservation) prerequisite = original.retain();
      original.requireSettled();
      if (!validResponse(method, result)) throw fail('ERR_LSP_HEALTH_MALFORMED_RESPONSE', `Malformed ${method} response.`);
      accepted = true;
      if (recovery || methods[method]) await update(method, null);
      original.requireSettled(); return result;
    } catch (error) {
      let primary = prerequisite ? addStorageFailureContext(error, {}, prerequisite, { secondaryPresent: true }) : error;
      observeStorageResource(primary, { phase: 'workspace-health-original-failure' }).requireSettled();
      if (accepted) {
        metric.persistenceFailures++;
        throw retainWorkspaceHealthDecision(primary, { kind: 'failed-admitted', method });
      }
      const observedFailure = failureClass(primary), classification = observedFailure?.failureClass;
      if (!classification) throw primary;
      bucket(method).lastFailureClass = classification;
      try { await update(method, classification); }
      catch (secondary) { primary = addStorageFailureContext(primary, {}, secondary, { secondaryPresent: true });
        metric.persistenceFailures++;
        throw retainWorkspaceHealthDecision(primary, { kind: 'failed-admitted', method, failureClass: classification }); }
      if (methods[method]?.cooldownUntil > clock()) {
        metric.withheldRetryAllowance += Number.isSafeInteger(retriesRemaining) && retriesRemaining > 0 ? retriesRemaining : 0;
        throw retainWorkspaceHealthDecision(primary, { kind: 'failed-admitted', method, failureClass: classification,
          methodScoped: Boolean(identity.fingerprint && stored.state === 'loaded' && observedFailure.methodScoped) });
      }
      throw primary;
    }
  };
  const recovering = new Set();
  return Object.freeze({ identity: Object.freeze({ ...identity }), metrics: () => structuredClone(metric),
    suppressBeforeAdmission(method) {
      if (!METHODS.has(method)) throw new TypeError('Unknown method-health admission.');
      if (!(methods[method]?.cooldownUntil > clock())) return false;
      bucket(method);
      if (!metric.preAdmissionMethods.includes(method)) metric.preAdmissionMethods.push(method);
      return true;
    },
    async run(method, operation, options = {}) {
      if (!METHODS.has(method) || typeof operation !== 'function') throw new TypeError('Unknown method-health request owner.');
      const state = methods[method];
      if (state?.cooldownUntil > clock()) throw deferred(method);
      if (!state?.cooldownUntil) return execute(method, operation, options);
      if (!filename) {
        if (recovering.has(method)) throw deferred(method);
        recovering.add(method); metric.recoveryProbes++; bucket(method).recoveryProbes++;
        try { return await execute(method, operation, { ...options, recovery: true }); }
        finally { recovering.delete(method); }
      }
      let entered = false;
      const result = await withFileLock({ lockPath: filename + '.' + digest(method).slice(0, 16) + '.probe.lock', waitMs: 0,
        staleMs: Number.MAX_SAFE_INTEGER, signal: identityInputs.signal,
        metadata: { scope: 'lsp-workspace-health-probe', hostname: os.hostname(), resourceSettlementVersion: 1 } }, async () => {
        entered = true;
        const latest = await read();
        if (latest.value) methods = { ...(latest.value.variants[identity.fingerprint]?.methods || {}) };
        if (methods[method]?.cooldownUntil > clock()) throw deferred(method);
        if (!methods[method]?.cooldownUntil) return execute(method, operation, options);
        metric.recoveryProbes++; bucket(method).recoveryProbes++;
        return execute(method, operation, { ...options, recovery: true });
      });
      if (!entered) throw deferred(method);
      return result;
    }
  });
};
