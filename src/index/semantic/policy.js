import { throwIfAborted } from '../../shared/abort.js';
import picomatch from 'picomatch';
import { normalizeSemanticConfig } from './config.js';
import { semanticHash } from './identity.js';
import { semanticAnalysisPolicyIdentity } from './analysis-versions.js';
const compiled = new WeakMap(), resolved = new WeakSet();
export const semanticPolicyIdentities = policy => ({
  extraction: semanticHash('semantic.extraction-policy.v1', { languages: policy.languages, baseFacts: policy.baseFacts }),
  analysis: semanticAnalysisPolicyIdentity(policy),
  layout: semanticHash('semantic.layout-policy.v1', { storage: policy.storage })
});
/** Match only repository-relative paths; segment policy uses its original container path. */
export const resolveSemanticSourcePolicy = (base, source) => {
  const policy = resolved.has(base) ? base : normalizeSemanticConfig(base);
  const path = String(source.path || '').replaceAll('\\', '/');
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.split('/').some(part => part === '..')) throw new TypeError('Semantic policy requires a repository-relative POSIX path.');
  let rules = compiled.get(policy);
  if (!rules) {
    rules = policy.overrides.map(rule => ({ ...rule, test: rule.match.path ? picomatch(rule.match.path, { dot: true, nocase: false, nonegate: true }) : null }));
    compiled.set(policy, rules);
  }
  const result = { ...policy, enrichment: { ...policy.enrichment }, planning: { ...policy.planning }, execution: { ...policy.execution }, matchingRuleIds: [] };
  for (const rule of rules) if ((!rule.match.language || rule.match.language === source.language) && (!rule.test || rule.test(path))) {
    result.matchingRuleIds.push(rule.id);
    for (const [key, value] of Object.entries(rule.set)) result[key] = { ...result[key], ...value };
  }
  result.targetSelectionConfigured = Boolean(policy.targets?.length);
  result.targets = (policy.targets || []).filter(target => target.sourceUnitId === source.sourceUnitId && target.sourceHash === source.sourceHash);
  result.staleTargetCount = (policy.targets || []).filter(target => target.sourceUnitId === source.sourceUnitId && target.sourceHash !== source.sourceHash).length;
  result.identity = semanticPolicyIdentities(result);
  resolved.add(result);
  return result;
};
/** A pinned ref selects an occurrence/declaration, or its owned lexical scope. */
export const semanticTargetMatchesRecord = (policy, partitionId, row, selectedScopes = new Set()) => {
  if (!policy.targetSelectionConfigured) return true;
  if (selectedScopes.has(row.scope?.localId)) return true;
  return policy.targets.some(target => target.ref
    ? target.ref.partitionId === partitionId && target.ref.localId === row.id && ['declaration', 'occurrence'].includes(row.kind)
    : row.span && row.span[0] >= target.range.start && row.span[1] <= target.range.end);
};
/** Selection is admission metadata, never a reason to omit source syntax rows. */
export const semanticPhasePolicy = (policy, plan, phase, runtime, sourceUnitId) => {
  const mode = plan?.modes?.[phase] || policy.enrichment[phase];
  const granted = runtime.semanticEnrichmentDrain?.phaseAllows?.(phase, sourceUnitId) === true;
  const admitted = mode !== 'off' && (mode === 'eager' || granted || (mode === 'deferred' && policy.execution.deferredDrain === 'after-index'));
  return { mode, admitted, granted };
};

/** Validate targeted refs without scanning the syntax graph. */
export const validateSemanticSourceTargets = async (policy, { source, partitionId, store, signal }) => {
  const refs = [];
  for (const target of policy.targets) {
    if (target.range && target.range.end > source.textLength) throw Object.assign(new RangeError('Semantic target exceeds its pinned source snapshot.'), { code: 'ERR_SEMANTIC_TARGET' });
    if (target.ref) {
      if (target.ref.partitionId !== partitionId) throw Object.assign(new TypeError('Semantic target must reference its source syntax partition.'), { code: 'ERR_SEMANTIC_TARGET' });
      refs.push(target.ref);
    }
  }
  for (let start = 0; start < refs.length; start += 64) {
    const records = await store.getRecords(refs.slice(start, start + 64), [], { signal });
    if (records.some(row => !row || !['declaration', 'occurrence'].includes(row.kind))) throw Object.assign(new TypeError('Semantic target must reference a declaration or occurrence.'), { code: 'ERR_SEMANTIC_TARGET' });
  }
};

/** Expand declaration selection to its enclosing lexical scope and descendants.
 * Variable declarations may require module scope; this widening is explicit to callers.
 */
export const collectSemanticTargetScopes = async ({ policy, store, partitionId, signal }) => {
  const selected = new Set(), children = new Map();
  if (!policy.targetSelectionConfigured) return selected;
  const refs = policy.targets.filter(target => target.ref?.partitionId === partitionId).map(target => target.ref);
  const selectedRefs = new Set(refs.map(ref => ref.partitionId + ':' + ref.localId));
  for (let offset = 0; offset < refs.length; offset += 64) {
    for (const row of await store.getRecords(refs.slice(offset, offset + 64), ['scope', 'data'], { signal })) {
      if (row?.kind === 'declaration' && row.scope?.partitionId === partitionId) selected.add(row.scope.localId);
    }
  }
  for await (const row of store.iterateRows(partitionId, 'semantic_records', { signal })) {
    if (row.kind !== 'scope') continue;
    if (row.data.owner && selectedRefs.has(row.data.owner.partitionId + ':' + row.data.owner.localId)) selected.add(row.id);
    if (row.data.parent?.partitionId === partitionId) {
      if (!children.has(row.data.parent.localId)) children.set(row.data.parent.localId, []);
      children.get(row.data.parent.localId).push(row.id);
    }
  }
  const pending = [...selected];
  while (pending.length) { throwIfAborted(signal); for (const child of children.get(pending.pop()) || []) if (!selected.has(child)) { selected.add(child); pending.push(child); } }
  return selected;
};
