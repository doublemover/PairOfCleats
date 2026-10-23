import { stableStringify } from '../../shared/stable-json.js';

const capturedIndexes = new WeakMap();
const text = value => typeof value === 'string' && value.length ? value : null;
const captureCall = call => ({
  callSiteId: text(call.callSiteId), file: text(call.file), callerChunkUid: text(call.callerChunkUid),
  start: call.start ?? null, end: call.end ?? null, startLine: call.startLine ?? null,
  startCol: call.startCol ?? null, endLine: call.endLine ?? null, endCol: call.endCol ?? null,
  calleeNormalized: text(call.calleeNormalized), targetChunkUid: text(call.targetChunkUid),
  invalidTarget: call.targetChunkUid != null && !text(call.targetChunkUid),
  args: Array.isArray(call.args) ? [...call.args] : null, confidence: call.confidence ?? null,
  resolution: call.extensions?.syntax?.resolution ?? null,
  indexSignature: call.indexSignature ?? null,
  semanticRef: call.extensions?.semanticRef ? structuredClone(call.extensions.semanticRef) : null
});

/** All ingestion routes capture and deduplicate actual rows here. Caller map
 * keys and lexical spellings are never target authority. The opaque result
 * cannot be forged into an already checked target index by an external caller.
 */
export const createApiContractCallTargetIndex = () => {
  const rows = new Map(); let inputCount = 0, duplicateCount = 0, invalidCount = 0;
  let finished = null;
  return Object.freeze({
    add(call) {
      if (finished) throw new Error('API contract call index is already sealed.');
      inputCount++;
      if (!call || typeof call !== 'object' || Array.isArray(call)) { invalidCount++; return; }
      const row = captureCall(call), fingerprint = stableStringify(row);
      const key = row.callSiteId ? stableStringify([row.callSiteId, row.indexSignature]) : fingerprint;
      const previous = rows.get(key);
      if (previous) { duplicateCount++; if (previous.fingerprint !== fingerprint) previous.conflict = true; }
      else rows.set(key, { row, fingerprint, conflict: false });
    },
    finish() {
      if (finished) return finished;
      const result = Object.freeze({});
      capturedIndexes.set(result, { rows, inputCount, duplicateCount, invalidCount });
      finished = result; return result;
    }
  });
};

const captureInputs = (callSites, callSitesByTarget) => {
  const captured = capturedIndexes.get(callSitesByTarget);
  if (captured) return captured;
  const builder = createApiContractCallTargetIndex();
  if (callSitesByTarget instanceof Map) {
    for (const rows of callSitesByTarget.values()) {
      if (!Array.isArray(rows)) throw new TypeError('API contract target buckets require call-site arrays.');
      for (const row of rows) builder.add(row);
    }
  } else for (const row of Array.isArray(callSites) ? callSites : []) builder.add(row);
  return capturedIndexes.get(builder.finish());
};
const addAlias = (map, alias, identity) => {
  if (!alias) return;
  let identities = map.get(alias); if (!identities) { identities = new Set(); map.set(alias, identities); }
  identities.add(identity);
};
const compareCalls = (a, b) => String(a.file || '').localeCompare(String(b.file || ''))
  || Number(a.startLine || 0) - Number(b.startLine || 0)
  || String(a.callSiteId || '').localeCompare(String(b.callSiteId || ''));
export const apiContractSymbolIdentity = symbol => stableStringify([text(symbol.symbolId) || text(symbol.id), text(symbol.chunkUid),
  symbol.file ?? null, symbol.symbolKey ?? null, symbol.signatureKey ?? null, symbol.signature ?? null,
  symbol.scheme ?? null, symbol.indexSignature ?? null, symbol.name ?? null, symbol.kind ?? null, symbol.exported ?? null,
  symbol.qualifiedName ?? null, symbol.scopedId ?? null, symbol.virtualPath ?? null, symbol.lang ?? null, symbol.kindGroup ?? null]);

/** Join once against the entire admitted symbol inventory before display caps
 * or export filtering. A recorded target is structural evidence, not runtime
 * dispatch/feasibility proof. Unknown or ambiguous lexical names remain counts.
 */
export const buildApiContractTargetJoins = ({ symbols, callSites, callSitesByTarget, provenance, metrics = null }) => {
  const byChunk = new Map(), bySymbol = new Map(), byName = new Map(), bindings = new Map(), symbolKeys = new Map();
  for (const symbol of symbols) {
    const symbolId = text(symbol.symbolId) || text(symbol.id), chunkUid = text(symbol.chunkUid);
    const identity = apiContractSymbolIdentity(symbol);
    symbolKeys.set(symbol, identity);
    if (symbolId && chunkUid) { bindings.set(identity, symbol); addAlias(byChunk, chunkUid, identity); addAlias(bySymbol, symbolId, identity); }
    addAlias(byName, text(symbol.name), identity);
    if (metrics) metrics.apiContractSymbolRows = (metrics.apiContractSymbolRows || 0) + 1;
  }
  const captured = captureInputs(callSites, callSitesByTarget), calls = new Map();
  const reasons = { 'invalid-call': captured.invalidCount, 'conflicting-call-identity': 0,
    'invalid-target': 0, 'unresolved-lexical': 0, 'ambiguous-lexical': 0, 'missing-target': 0,
    'unknown-target': 0, 'ambiguous-target': 0, 'generation-mismatch': 0 };
  let qualifiedCount = 0;
  const scope = provenance.indexSignature || null;
  const normalized = new Map(); let duplicateCount = captured.duplicateCount;
  for (const entry of captured.rows.values()) {
    const { row } = entry, scoped = { ...row, indexSignature: row.indexSignature ?? scope };
    const fingerprint = stableStringify(scoped);
    const key = row.callSiteId ? stableStringify([row.callSiteId, scoped.indexSignature]) : fingerprint;
    const previous = normalized.get(key);
    if (previous) { duplicateCount++; previous.conflict ||= entry.conflict || previous.fingerprint !== fingerprint; }
    else normalized.set(key, { row, fingerprint, conflict: entry.conflict });
  }
  for (const { row, conflict } of normalized.values()) {
    if (metrics) metrics.apiContractCallRows = (metrics.apiContractCallRows || 0) + 1;
    let reason = conflict ? 'conflicting-call-identity' : row.invalidTarget ? 'invalid-target' : null;
    if (!reason && row.indexSignature !== null && row.indexSignature !== scope) reason = 'generation-mismatch';
    if (!reason && !row.targetChunkUid) reason = row.calleeNormalized
      ? (byName.get(row.calleeNormalized)?.size > 1 ? 'ambiguous-lexical' : 'unresolved-lexical') : 'missing-target';
    let identity, symbol;
    if (!reason) {
      if (metrics) metrics.apiContractTargetLookups = (metrics.apiContractTargetLookups || 0) + 1;
      const targets = byChunk.get(row.targetChunkUid);
      if (!targets?.size) reason = 'unknown-target';
      else if (targets.size !== 1 || ['ambiguous', 'unresolved'].includes(row.resolution)) reason = 'ambiguous-target';
      else {
        [identity] = targets; symbol = bindings.get(identity);
        if (bySymbol.get(text(symbol.symbolId) || text(symbol.id))?.size !== 1) reason = 'ambiguous-target';
        else if (symbol.indexSignature != null && symbol.indexSignature !== scope) reason = 'generation-mismatch';
      }
    }
    if (reason) { reasons[reason]++; continue; }
    const joined = { ...row, join: { schemaVersion: 1, qualification: 'recorded-target-chunk',
      targetChunkUid: row.targetChunkUid, symbolId: text(symbol.symbolId) || text(symbol.id),
      providerScheme: text(symbol.scheme), indexSignature: scope, indexCompatKey: provenance.indexCompatKey || null } };
    let selected = calls.get(identity); if (!selected) { selected = []; calls.set(identity, selected); }
    selected.push(joined); qualifiedCount++;
  }
  for (const rows of calls.values()) rows.sort(compareCalls);
  return {
    forSymbol: symbol => calls.get(symbolKeys.get(symbol)) || [],
    evidence: { schemaVersion: 1, policy: 'recorded-target-only', inputCallCount: captured.inputCount,
      duplicateCallCount: duplicateCount, totalCallCount: normalized.size + captured.invalidCount,
      qualifiedCallCount: qualifiedCount, unresolvedCallCount: Object.values(reasons).reduce((sum, count) => sum + count, 0),
      unresolvedByReason: reasons, unresolvedDetails: 'counts-only', reportedCallCount: 0, omittedQualifiedCallCount: 0 }
  };
};
