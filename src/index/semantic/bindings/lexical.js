import { createHash } from 'node:crypto';
import { canonicalSemanticJson } from '../identity.js';
import { validateSemanticEnvelope } from '../../../contracts/validators/semantic-envelopes.js';

const key = canonicalSemanticJson;
const compareRefs = (left, right) => key(left.ref) < key(right.ref) ? -1 : key(left.ref) > key(right.ref) ? 1 : 0;
const digest = value => createHash('sha256').update(key(value)).digest('hex');
const validText = value => typeof value === 'string' && value.length > 0 && value.length <= 4096;
const validRef = value => value && /^(sy1|sa1):[a-f0-9]{64}$/.test(value.partitionId)
  && Number.isSafeInteger(value.localId) && value.localId >= 0;
const invalid = message => { throw Object.assign(new TypeError(message), { code: 'ERR_BINDING_QUERY_CONTRACT' }); };

/** Closed lexical pilot. Imports/type-dependent and access-sensitive path order are unsupported. */
export const resolveLexicalBinding = ({ world, profile, scopes, declarations, query,
  maxVisits = 4096, signal }) => {
  if (!world || !validateSemanticEnvelope('generation', world.generation).ok
    || !['repositoryNamespace', 'sourceSnapshotId', 'contextKey'].every(name => validText(world[name]))) invalid('Immutable binding world required.');
  if (profile?.id !== 'lexical-local-first-v1' || profile.version !== 1
    || !Array.isArray(profile.namespaces) || !profile.namespaces.length
    || profile.namespaces.length > 32 || profile.namespaces.some(name => !validText(name))
    || new Set(profile.namespaces).size !== profile.namespaces.length) invalid('Unsupported lexical binding profile.');
  if (!validRef(query?.startScope) || !validRef(query.occurrence)
    || !profile.namespaces.includes(query.namespace) || !validText(query.datumKey)) invalid('Invalid binding query.');
  if (!Array.isArray(scopes) || scopes.length > 16384 || !Array.isArray(declarations)
    || declarations.length > 65536 || !Number.isSafeInteger(maxVisits) || maxVisits < 0) invalid('Invalid binding input or work allowance.');
  const scopeMap = new Map();
  const byScope = new Map();
  for (const scope of scopes) {
    if (!validRef(scope.ref) || scopeMap.has(key(scope.ref))
      || !Object.hasOwn(scope, 'parent') || scope.parent != null && !validRef(scope.parent)
      || typeof scope.declarationsClosed !== 'boolean' || typeof scope.parentClosed !== 'boolean'
      || !Array.isArray(scope.unsupported) || scope.unsupported.some(feature => !validText(feature))) invalid('Invalid lexical scope.');
    if ((scope.declarationsClosed || scope.parentClosed) && !validText(scope.closureReceiptId)) invalid('Scope closure requires an admitted receipt.');
    scopeMap.set(key(scope.ref), scope);
  }
  const declared = new Set();
  for (const declaration of declarations) {
    if (!validRef(declaration.ref) || declared.has(key(declaration.ref)) || !validRef(declaration.scope)
      || !scopeMap.has(key(declaration.scope)) || !profile.namespaces.includes(declaration.namespace)
      || !validText(declaration.datumKey) || !['allowed', 'denied', 'unknown'].includes(declaration.access)) invalid('Invalid lexical declaration.');
    declared.add(key(declaration.ref));
    const scopeId = key(declaration.scope);
    if (!byScope.has(scopeId)) byScope.set(scopeId, []);
    byScope.get(scopeId).push(declaration);
  }
  const answer = { schemaVersion: 1, world: structuredClone(world), profileId: profile.id,
    profileHash: digest(profile), queryId: digest({ world, profile, query }), query: structuredClone(query),
    status: 'unknown', certainty: 'exact-in-model', completeInProfile: false,
    targets: [], rejected: [], paths: [], dependencies: [], frontier: [], visits: 0,
    diagnosticClosure: 'not-assessed', wellFormed: 'not-assessed' };
  let current = query.startScope;
  const visited = new Set();
  const path = [];
  const defer = (reason, ref = current) => {
    answer.frontier.push({ reason, scope: structuredClone(ref) });
    answer.status = 'unknown';
    return answer;
  };
  while (current) {
    if (signal?.aborted) return defer('cancelled');
    if (answer.visits >= maxVisits) return defer('work-budget');
    const scopeId = key(current);
    if (visited.has(scopeId)) return defer('lexical-cycle');
    visited.add(scopeId);
    answer.visits++;
    const scope = scopeMap.get(scopeId);
    if (!scope) return defer('scope-unavailable');
    path.push(structuredClone(current));
    const candidates = (byScope.get(scopeId) || []).filter(row => row.namespace === query.namespace && row.datumKey === query.datumKey)
      .sort(compareRefs);
    answer.dependencies.push({ scope: structuredClone(current), namespace: query.namespace, datumKey: query.datumKey,
      kind: candidates.length ? 'positive-lookup' : 'negative-lookup',
      inventoryDigest: digest(candidates), closureReceiptId: scope.closureReceiptId || null,
      parentDigest: digest({ parent: scope.parent, parentClosed: scope.parentClosed, unsupported: scope.unsupported }) });
    if (scope.unsupported.length) return defer('unsupported-scope-feature');
    if (!scope.declarationsClosed) return defer('declaration-frontier-open');
    if (candidates.length) {
      // Local declarations shadow outer scopes even when inaccessible in this profile.
      for (const candidate of candidates) {
        answer.paths.push({ target: structuredClone(candidate.ref), scopes: structuredClone(path) });
        if (candidate.access === 'allowed') answer.targets.push(structuredClone(candidate.ref));
        else answer.rejected.push({ target: structuredClone(candidate.ref), reason: candidate.access === 'denied' ? 'inaccessible' : 'access-unknown' });
      }
      if (candidates.some(candidate => candidate.access === 'unknown')) return defer('accessibility-frontier-open');
      answer.completeInProfile = true;
      answer.status = answer.targets.length > 1 ? 'ambiguous' : answer.targets.length === 1 ? 'resolved' : 'inaccessible';
      return answer;
    }
    if (!scope.parentClosed) return defer('parent-frontier-open');
    current = scope.parent;
  }
  answer.completeInProfile = true;
  answer.status = 'missing';
  return answer;
};

/** Confirmation is conservative: a changed world needs a separately admitted re-resolution. */
export const confirmLexicalDependencies = ({ answer, world, profile, scopes, declarations }) => {
  if (!answer.completeInProfile || key(answer.world) !== key(world) || answer.profileHash !== digest(profile)) {
    return { state: 'unknown', reason: 'world-profile-or-closure-changed' };
  }
  for (const dependency of answer.dependencies) {
    const scope = scopes.find(row => key(row.ref) === key(dependency.scope));
    if (!scope || !scope.declarationsClosed || !scope.parentClosed && dependency.kind === 'negative-lookup') {
      return { state: 'unknown', reason: 'scope-frontier-open' };
    }
    const candidates = declarations.filter(row => key(row.scope) === key(dependency.scope)
      && row.namespace === dependency.namespace && row.datumKey === dependency.datumKey)
      .sort(compareRefs);
    if (dependency.inventoryDigest !== digest(candidates) || dependency.closureReceiptId !== scope.closureReceiptId
      || dependency.parentDigest !== digest({ parent: scope.parent, parentClosed: scope.parentClosed, unsupported: scope.unsupported })) {
      return { state: 'invalid', reason: 'lookup-or-frontier-changed' };
    }
  }
  return { state: 'valid', reason: 'direct-footprints-unchanged' };
};
