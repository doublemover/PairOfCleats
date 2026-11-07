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

const preparedModels = new WeakMap();
const emptyDigest = digest([]);
/** Private operation-owned snapshot. The handle carries no serializable model
 * authority; copied handles cannot supply scopes, closures or candidate buckets.
 */
export const prepareLexicalBindingModel = ({ world, profile, scopes, declarations }, { charge = null } = {}) => {
  if (!Array.isArray(scopes) || scopes.length > 16384 || !Array.isArray(declarations)
    || declarations.length > 65536) invalid('Invalid binding input or work allowance.');
  if (charge && !charge('preparationRecords', scopes.length + declarations.length)) invalid('Lexical preparation work allowance exceeded.');
  // Admission precedes snapshot allocation. Bound total metadata, not only rows.
  let captured;
  try { captured = JSON.parse(canonicalSemanticJson({ world, profile, scopes, declarations }, { maxBytes: 16 * 1024 * 1024 })); }
  catch { invalid('Lexical model metadata exceeds its bounded JSON contract.'); }
  ({ world, profile, scopes, declarations } = captured);
  if (!world || !validateSemanticEnvelope('generation', world.generation).ok
    || !['repositoryNamespace', 'sourceSnapshotId', 'contextKey'].every(name => validText(world[name]))) invalid('Immutable binding world required.');
  if (profile?.id !== 'lexical-local-first-v1' || profile.version !== 1
    || !Array.isArray(profile.namespaces) || !profile.namespaces.length
    || profile.namespaces.length > 32 || profile.namespaces.some(name => !validText(name))
    || new Set(profile.namespaces).size !== profile.namespaces.length) invalid('Unsupported lexical binding profile.');
  const scopeMap = new Map(), buckets = new Map(), parents = new Map();
  for (const scope of scopes) {
    if (!validRef(scope?.ref)) invalid('Invalid lexical scope.');
    const scopeId = key(scope.ref);
    if (!validRef(scope.ref) || scopeMap.has(scopeId)
      || !Object.hasOwn(scope, 'parent') || scope.parent != null && !validRef(scope.parent)
      || typeof scope.declarationsClosed !== 'boolean' || typeof scope.parentClosed !== 'boolean'
      || !Array.isArray(scope.unsupported) || scope.unsupported.some(feature => !validText(feature))) invalid('Invalid lexical scope.');
    if ((scope.declarationsClosed || scope.parentClosed) && !validText(scope.closureReceiptId)) invalid('Scope closure requires an admitted receipt.');
    scopeMap.set(scopeId, scope);
    parents.set(scopeId, digest({ parent: scope.parent, parentClosed: scope.parentClosed, unsupported: scope.unsupported }));
  }
  const declared = new Set(), declarationKeys = new WeakMap();
  for (const declaration of declarations) {
    if (!validRef(declaration?.ref) || !validRef(declaration.scope)) invalid('Invalid lexical declaration.');
    const refId = key(declaration.ref), scopeId = key(declaration.scope);
    if (declared.has(refId) || !scopeMap.has(scopeId) || !profile.namespaces.includes(declaration.namespace)
      || !validText(declaration.datumKey) || !['allowed', 'denied', 'unknown'].includes(declaration.access)) invalid('Invalid lexical declaration.');
    declared.add(refId); declarationKeys.set(declaration, refId);
    if (!buckets.has(scopeId)) buckets.set(scopeId, new Map());
    const namespaces = buckets.get(scopeId);
    if (!namespaces.has(declaration.namespace)) namespaces.set(declaration.namespace, new Map());
    const names = namespaces.get(declaration.namespace);
    if (!names.has(declaration.datumKey)) names.set(declaration.datumKey, { rows: [], digest: null });
    names.get(declaration.datumKey).rows.push(declaration);
  }
  for (const namespaces of buckets.values()) for (const names of namespaces.values()) for (const bucket of names.values()) {
    if (charge && !charge('preparedBuckets', 1 + bucket.rows.length * Math.ceil(Math.log2(bucket.rows.length + 1)))) invalid('Lexical preparation work allowance exceeded.');
    bucket.rows.sort((left, right) => {
      const a = declarationKeys.get(left), b = declarationKeys.get(right);
      return a < b ? -1 : a > b ? 1 : 0;
    });
    bucket.digest = digest(bucket.rows);
  }
  const handle = Object.freeze({});
  preparedModels.set(handle, { worldIdentity: key(world), profile, profileHash: digest(profile), scopeMap, buckets, parents, charge });
  return handle;
};

/** Closed lexical pilot. Each answer remains qualified by its own world/query;
 * preparing a model never caches an answer or grants source-edit authority.
 */
export const resolvePreparedLexicalBinding = (model, { world, query,
  maxVisits = 4096, maxCandidates = 128, maxWitnessRefs = 16384, signal }) => {
  const prepared = preparedModels.get(model);
  if (!prepared) invalid('An original prepared lexical model is required.');
  const { worldIdentity, profile, profileHash, scopeMap, buckets, parents, charge } = prepared;
  if (!world || !validateSemanticEnvelope('generation', world.generation).ok
    || !['repositoryNamespace', 'sourceSnapshotId', 'contextKey'].every(name => validText(world[name]))) invalid('Immutable binding world required.');
  if (key(world) !== worldIdentity) invalid('Prepared lexical model belongs to a different binding world.');
  if (!validRef(query?.startScope) || !validRef(query.occurrence)
    || !profile.namespaces.includes(query.namespace) || !validText(query.datumKey)) invalid('Invalid binding query.');
  if (!Number.isSafeInteger(maxVisits) || maxVisits < 0 || maxVisits > 16384
    || !Number.isSafeInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 128
    || !Number.isSafeInteger(maxWitnessRefs) || maxWitnessRefs < 1 || maxWitnessRefs > 16384) invalid('Invalid binding input or work allowance.');
  const answer = { schemaVersion: 1, world: structuredClone(world), profileId: profile.id,
    profileHash, queryId: digest({ world, profile, query }), query: structuredClone(query),
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
    const bucket = buckets.get(scopeId)?.get(query.namespace)?.get(query.datumKey);
    const candidates = bucket?.rows || [];
    if (charge && !charge('lookupVisits', 1)) return defer('work-budget');
    answer.dependencies.push({ scope: structuredClone(current), namespace: query.namespace, datumKey: query.datumKey,
      kind: candidates.length ? 'positive-lookup' : 'negative-lookup',
      inventoryDigest: bucket?.digest || emptyDigest, closureReceiptId: scope.closureReceiptId || null,
      parentDigest: parents.get(scopeId) });
    if (scope.unsupported.length) return defer('unsupported-scope-feature');
    if (!scope.declarationsClosed) return defer('declaration-frontier-open');
    if (candidates.length) {
      if (candidates.length > maxCandidates) return defer('candidate-budget');
      if (candidates.length * path.length > maxWitnessRefs) return defer('witness-budget');
      if (charge && !charge('witnessRefs', candidates.length * path.length)) return defer('work-budget');
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

export const resolveLexicalBinding = ({ profile, scopes, declarations, ...request }) =>
  resolvePreparedLexicalBinding(prepareLexicalBindingModel({ world: request.world, profile, scopes, declarations }), request);

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
