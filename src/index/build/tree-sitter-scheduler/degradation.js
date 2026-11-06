import { parseVfsVirtualPathIdentity } from '../../tooling/vfs/virtual-path.js';

export const SCHEDULER_DEGRADATION_VERSION = 1;

/** The crash producer declares exact canonical identities in the current receipt. */
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
export const assertSchedulerDegradationReceipt = receipt => {
  if (!receipt || receipt.schemaVersion !== SCHEDULER_DEGRADATION_VERSION
    || !Array.isArray(receipt.scopes) || !Array.isArray(receipt.unknown)) throw Object.assign(
    new TypeError('Scheduler degradation requires its current typed receipt; rerun the scheduler.'),
    { code: 'ERR_SCHEDULER_DEGRADATION_VERSION' });
  return receipt;
};

export const createSchedulerDegradationQuery = input => {
  const receipt = assertSchedulerDegradationReceipt(input);
  const grammar = new Map(), containers = new Map(), segments = new Map();
  const unknown = [...receipt.unknown];
  for (const entry of receipt.scopes) {
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
    return { degraded: false, scope: null, reason: null };
  };
  return { query, unknown: structuredClone(unknown), receipt: structuredClone(receipt) };
};
