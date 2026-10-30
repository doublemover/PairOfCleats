import { parseVfsVirtualPathIdentity } from '../../tooling/vfs/virtual-path.js';

export const SCHEDULER_DEGRADATION_VERSION = 1;

/** Legacy summaries admit exact canonical VFS identities, never display prefixes. */
export const buildSchedulerDegradationReceipt = ({ failedGrammarKeys = [], degradedVirtualPaths = [] } = {}) => {
  const scopes = [], unknown = [];
  for (const grammarKey of new Set(failedGrammarKeys)) {
    if (typeof grammarKey === 'string' && grammarKey) scopes.push({ scope: 'grammar', grammarKey, reason: 'failed-grammar' });
  }
  for (const virtualPath of new Set(degradedVirtualPaths)) {
    const identity = parseVfsVirtualPathIdentity(virtualPath);
    if (identity) scopes.push({ scope: identity.scope, virtualPath, reason: 'exact-' + identity.scope });
    else unknown.push({ virtualPath: typeof virtualPath === 'string' ? virtualPath : null, reason: 'unqualified-virtual-path' });
  }
  return { schemaVersion: SCHEDULER_DEGRADATION_VERSION, scopes, unknown };
};

/** One indexed scope owner is shared by the runner and chunk consumer. */
export const createSchedulerDegradationQuery = (summary = {}, { legacyExactCheck = null } = {}) => {
  const receipt = summary.degradation || buildSchedulerDegradationReceipt(summary);
  const grammar = new Map(), containers = new Map(), segments = new Map();
  for (const entry of buildSchedulerDegradationReceipt({ failedGrammarKeys: summary.failedGrammarKeys }).scopes) {
    grammar.set(entry.grammarKey, entry);
  }
  const unknown = [...(Array.isArray(receipt.unknown) ? receipt.unknown : [])];
  if (receipt.schemaVersion !== SCHEDULER_DEGRADATION_VERSION) unknown.push({ reason: 'unsupported-receipt-version' });
  else for (const entry of Array.isArray(receipt.scopes) ? receipt.scopes : []) {
    if (!entry || typeof entry !== 'object') { unknown.push({ reason: 'invalid-scope' }); continue; }
    const captured = { scope: entry.scope, reason: typeof entry.reason === 'string' ? entry.reason : 'declared-' + entry.scope,
      ...(entry.scope === 'grammar' ? { grammarKey: entry.grammarKey } : { virtualPath: entry.virtualPath }) };
    if (entry.scope === 'grammar' && typeof entry.grammarKey === 'string' && entry.grammarKey) {
      grammar.set(entry.grammarKey, captured);
      continue;
    }
    const identity = parseVfsVirtualPathIdentity(entry.virtualPath);
    if (identity && entry.scope === identity.scope) {
      (entry.scope === 'container' ? containers : segments).set(entry.virtualPath, captured);
    } else unknown.push({ virtualPath: entry.virtualPath || null, reason: 'invalid-scope-identity' });
  }
  const query = ({ virtualPath, grammarKey = null }) => {
    const grammarFailure = grammar.get(grammarKey);
    if (grammarFailure) return { degraded: true, ...grammarFailure };
    const container = parseVfsVirtualPathIdentity(virtualPath)?.containerVirtualPath;
    const match = containers.get(container) || segments.get(virtualPath);
    if (match) return { degraded: true, ...match };
    // Older adapters can attest the exact queried key. They cannot widen a
    // segment result into a container or infer another key by substring.
    if (legacyExactCheck && container && legacyExactCheck(container) === true) {
      return { degraded: true, scope: 'container', virtualPath: container, reason: 'legacy-exact-container' };
    }
    if (legacyExactCheck?.(virtualPath) === true) {
      return { degraded: true, scope: 'segment', virtualPath, reason: 'legacy-exact-segment' };
    }
    return { degraded: false, scope: null, reason: null };
  };
  return { query, unknown: structuredClone(unknown), receipt: structuredClone(receipt) };
};
