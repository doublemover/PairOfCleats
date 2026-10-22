import { throwIfAborted, isAbortError } from '../../../../shared/abort.js';
import { canonicalSemanticJson, semanticHash } from '../../../../index/semantic/identity.js';
import { projectLspObservation } from './observation-projector.js';
import { LSP_STRUCTURED_METHODS, LSP_OBSERVATION_CONSUMERS } from './observation-methods.js';

const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const fail = message => Object.assign(new Error(message), { code: 'ERR_LSP_OBSERVATION_IDENTITY' });
const freeze = value => {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
};

/** Session-local raw acquisition. The existing LSP client/guard owns transport,
 * deadline cancellation and process lifetime. No signature-only cache is read. */
export const createLspObservationCollector = ({ identity, consumers, capabilities = {}, sourceForUri,
  request = null, requestBudgets = {}, isCurrent = () => true, projectReady = 'unknown',
  maxRequests = 64, maxFacts = 256, maxBytes = 1024 * 1024, maxDepth = 16,
  maxMs = 30000, signal = null }) => {
  if (!identity || !hash(identity.sourceHash) || !hash(identity.contextHash)
    || !identity.sourceUnitId || !identity.sessionId || !identity.profileId || !identity.generation
    || typeof sourceForUri !== 'function') throw fail('Source/session/profile/generation identity is required.');
  for (const [name, value, maximum] of [['requests', maxRequests, 4096], ['facts', maxFacts, 16384],
    ['bytes', maxBytes, 16 * 1024 * 1024], ['depth', maxDepth, 64], ['time', maxMs, 30000]]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw fail(`Invalid structured LSP ${name} budget.`);
  }
  if (!Array.isArray(consumers) || !consumers.length || consumers.some(value => !Object.hasOwn(LSP_OBSERVATION_CONSUMERS, value))) throw fail('Declare supported observation consumers before acquisition.');
  const pinned = freeze(JSON.parse(canonicalSemanticJson(identity)));
  const requested = new Set(consumers.flatMap(value => LSP_OBSERVATION_CONSUMERS[value]));
  const cache = new Map(), pending = new Map(), items = new Map(), disabled = new Set(), observations = [];
  const startedAt = performance.now();
  let requests = 0, facts = 0, bytes = 0, invalidated = false;
  const assertCurrent = () => {
    throwIfAborted(signal);
    if (invalidated || isCurrent(pinned) !== true) throw fail('Structured LSP session, source or profile changed.');
  };
  const callHierarchy = new Set(['prepareCallHierarchy', 'incomingCalls', 'outgoingCalls']);
  const typeHierarchy = new Set(['prepareTypeHierarchy', 'supertypes', 'subtypes']);
  const empty = (requestClass, params, reason, state = 'unsupported') => ({ schemaVersion: 1, identity: pinned,
    requestClass, method: LSP_STRUCTURED_METHODS[requestClass] || null, params, raw: null,
    state, reason, facts: [], factUnits: 0, omissions: [], exactCount: 0, coverage: 'unknown', projectReady });
  const record = ({ requestClass, params, response, positionEncoding = 'utf-16' }) => {
    assertCurrent();
    const normalizedParams = freeze(JSON.parse(canonicalSemanticJson(params)));
    if (!requested.has(requestClass)) return empty(requestClass, normalizedParams, 'consumer_not_declared');
    const key = semanticHash('lsp.structured-request.v1', { identity: pinned, requestClass, params: normalizedParams, positionEncoding });
    if (cache.has(key)) return cache.get(key);
    if (performance.now() - startedAt >= maxMs) return empty(requestClass, normalizedParams, 'wall_budget', 'partial');
    if (observations.length >= maxRequests) return empty(requestClass, normalizedParams, 'observation_budget', 'partial');
    if (response?.attempted !== true) return empty(requestClass, normalizedParams, response?.skipReason || 'request_not_admitted');
    if (response.error) {
      if (response.error.code === -32601 || response.error.code === 'METHOD_NOT_FOUND') disabled.add(requestClass);
      const value = { ...empty(requestClass, normalizedParams, 'request_failed', 'failed'), error: {
        code: typeof response.error.code === 'number' && Number.isFinite(response.error.code) ? response.error.code
          : String(response.error.code || 'ERR_LSP_REQUEST').slice(0, 128),
        message: String(response.error.message || 'LSP request failed').slice(0, 1024)
      } };
      const retainedBytes = Buffer.byteLength(canonicalSemanticJson(value));
      if (retainedBytes > maxBytes - bytes) return empty(requestClass, normalizedParams, 'output_budget', 'partial');
      bytes += retainedBytes;
      freeze(value); observations.push(value); cache.set(key, value); return value;
    }
    if (!Object.hasOwn(response, 'payload') || response.payload === undefined) return empty(requestClass, normalizedParams, 'raw_payload_unavailable', 'partial');
    const rawText = canonicalSemanticJson(response.payload);
    const rawBytes = Buffer.byteLength(rawText);
    if (rawBytes > maxBytes - bytes || facts >= maxFacts || observations.length >= maxRequests) {
      return empty(requestClass, normalizedParams, 'output_budget', 'partial');
    }
    const raw = JSON.parse(rawText);
    // Items borrow the admitted raw response's immutable subtree. Stage tokens
    // locally until the complete observation passes its shared byte allowance;
    // a discarded response cannot leave retained opaque provider data behind.
    const pendingItems = new Map();
    const family = callHierarchy.has(requestClass) ? 'call' : typeHierarchy.has(requestClass) ? 'type' : null;
    const retainHierarchyItem = item => {
      if (!family) return null;
      const token = semanticHash('lsp.hierarchy-item.v2', { identity: pinned, family, item });
      if (items.has(token) || pendingItems.has(token)) return token;
      if (items.size + pendingItems.size >= maxFacts) return null;
      pendingItems.set(token, { item, family });
      return token;
    };
    const projected = projectLspObservation({ requestClass, payload: raw, uri: normalizedParams.textDocument?.uri || normalizedParams.item?.uri || pinned.uri,
      positionEncoding, sourceForUri, maxFacts: maxFacts - facts, maxDepth, requestItem: normalizedParams.item || null, retainHierarchyItem });
    assertCurrent();
    const value = { schemaVersion: 1, identity: pinned, requestClass, method: LSP_STRUCTURED_METHODS[requestClass],
      params: normalizedParams, positionEncoding, raw, ...projected, projectReady,
      state: projected.omissions.length || projected.exactCount !== projected.facts.length || projectReady !== 'ready' ? 'partial' : 'complete',
      reason: projected.omissions.length ? 'projection_partial' : projectReady !== 'ready' ? 'project_readiness_unknown' : null,
      coverage: 'requested_scope' };
    const projectedBytes = Buffer.byteLength(canonicalSemanticJson(value));
    if (projectedBytes > maxBytes - bytes) return empty(requestClass, normalizedParams, 'output_budget', 'partial');
    freeze(value);
    for (const [token, retained] of pendingItems) items.set(token, retained);
    bytes += projectedBytes; facts += projected.factUnits;
    observations.push(value); cache.set(key, value);
    return value;
  };
  const acquireOnce = async ({ requestClass, params, positionEncoding = 'utf-16' }) => {
    assertCurrent();
    const key = semanticHash('lsp.structured-request.v1', { identity: pinned, requestClass, params, positionEncoding });
    if (cache.has(key)) return cache.get(key);
    if (!requested.has(requestClass)) return empty(requestClass, params, 'consumer_not_declared');
    if (capabilities[requestClass] !== true || disabled.has(requestClass)) return empty(requestClass, params, 'capability_unavailable');
    if (typeof request !== 'function') return empty(requestClass, params, 'transport_unavailable');
    const budget = requestBudgets[requestClass];
    if (requests >= maxRequests || performance.now() - startedAt >= maxMs
      || !budget || typeof budget.tryReserve !== 'function' || !budget.tryReserve()) return empty(requestClass, params, 'request_budget', 'partial');
    requests += 1;
    let response;
    try {
      response = { attempted: true, payload: await request(LSP_STRUCTURED_METHODS[requestClass], params, {
        signal, timeoutMs: Math.max(1, Math.floor(maxMs - (performance.now() - startedAt)))
      }) };
    } catch (error) {
      if (isAbortError(error)) throw error;
      response = { attempted: true, error: { code: error.code || 'ERR_LSP_REQUEST', message: String(error.message || error).slice(0, 1024) } };
    }
    assertCurrent();
    return record({ requestClass, params, response, positionEncoding });
  };
  const acquire = (options) => {
    assertCurrent();
    const supplied = JSON.parse(canonicalSemanticJson(options));
    const normalized = freeze({ requestClass: supplied.requestClass, params: supplied.params,
      positionEncoding: supplied.positionEncoding || 'utf-16' });
    const key = semanticHash('lsp.structured-request.v1', { identity: pinned, ...normalized });
    if (pending.has(key)) return pending.get(key);
    const promise = acquireOnce(normalized).finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
  };
  return {
    record, acquire, assertCurrent,
    observations: () => structuredClone(observations),
    metrics: () => ({ requests, facts, bytes, retainedItems: items.size }),
    invalidate: () => { invalidated = true; cache.clear(); pending.clear(); items.clear(); observations.length = 0; },
    async hierarchy({ itemToken, requestClass, positionEncoding = 'utf-16', depth = 1 }) {
      assertCurrent();
      if (!['incomingCalls', 'outgoingCalls', 'supertypes', 'subtypes'].includes(requestClass)
        || !Number.isSafeInteger(depth) || depth < 1 || depth > maxDepth) return empty(requestClass, {}, 'hierarchy_depth_budget', 'partial');
      const retained = items.get(itemToken);
      if (!retained) throw fail('Hierarchy item belongs to another or expired session/profile.');
      const family = callHierarchy.has(requestClass) ? 'call' : 'type';
      if (retained.family !== family) throw fail('Hierarchy item belongs to another request family.');
      return acquire({ requestClass, params: { item: retained.item }, positionEncoding });
    }
  };
};
