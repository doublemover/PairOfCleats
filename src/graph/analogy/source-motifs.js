import { canonicalSemanticJson, semanticHash } from '../../index/semantic/identity.js';
import { admitOwnedSemanticSourceSnapshot } from '../../index/semantic/source-snapshot-admission.js';
import { validateSemanticEnvelope } from '../../contracts/validators/semantic-envelopes.js';
import { materializeTaskLens } from '../../context-pack/task-evidence/lens.js';
import { enforceContextPackResponseBudget } from '../../context-pack/response-budget.js';

const views = new WeakMap(), matches = new WeakMap();
const key = canonicalSemanticJson;
const text = value => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 4096;
const fields = (value, names) => value && Object.getPrototypeOf(value) === Object.prototype
  && !Object.getOwnPropertySymbols(value).length && Object.keys(value).length === names.length
  && names.every(name => Object.hasOwn(value, name) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, name), 'value'));
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const fail = message => { throw new TypeError('Source motif: ' + message); };
const motifs = freeze({
  'validate-before-publish/v1': {
    roles: ['producer', 'artifact', 'validator', 'publisher'],
    relations: [['produces', 'producer', 'artifact'], ['validates', 'validator', 'artifact'], ['publishes', 'publisher', 'artifact']],
    conditions: ['same-validated-published-bytes', 'success-dominates-publish', 'no-post-validation-mutation',
      'atomic-visible-generation', 'failure-preserves-prior-generation']
  },
  'cache-with-invalidation/v1': {
    roles: ['input', 'summary', 'reader', 'invalidator'],
    relations: [['depends-on', 'summary', 'input'], ['reads', 'reader', 'summary'], ['invalidates', 'invalidator', 'summary']],
    conditions: ['key-covers-context', 'positive-and-negative-dependencies', 'mutation-intersects-footprint',
      'invalidates-before-replay', 'version-rejects-incompatible-payload', 'replacement-publication-is-atomic']
  },
  'shared-call-target/v1': {
    roles: ['leftCall', 'rightCall', 'target'],
    relations: [['callTarget', 'leftCall', 'target'], ['callTarget', 'rightCall', 'target']],
    conditions: ['binding-coverage-qualified', 'argument-contract-compatible', 'effect-order-compatible',
      'target-body-available', 'transfer-preserves-build-context']
  }
});

/** Projection of supplied source facts only; role tags are declared inputs, never inferred behavioral facts. */
export const createSourceRoleView = ({ world, nodes, relations, sources, coverage }) => {
  if (!fields(world, ['generation', 'repositoryNamespace', 'contextKey'])
    || !validateSemanticEnvelope('generation', world.generation).ok || !text(world.repositoryNamespace) || !text(world.contextKey)
    || !Array.isArray(nodes) || nodes.length > 64 || !Array.isArray(relations) || relations.length > 4096
    || !Array.isArray(sources) || sources.length > 256 || !['complete-declared-view', 'partial'].includes(coverage)) fail('bounded qualified role view required');
  const sourceMap = new Map(), ownedSnapshots = [];
  let bytes = 0, metadataBytes = 0;
  for (const snapshot of sources) {
    const source = admitOwnedSemanticSourceSnapshot(snapshot, { repositoryNamespace: world.repositoryNamespace });
    bytes += source.byteLength;
    if (bytes > 8 * 1024 * 1024) fail('source byte allowance exceeded');
    if (sourceMap.has(source.manifest.sourceUnitId)) fail('duplicate source identity');
    sourceMap.set(source.manifest.sourceUnitId, source);
    ownedSnapshots.push(Object.freeze({ sourceCapability: snapshot.sourceCapability,
      manifest: freeze(JSON.parse(key(source.manifest))) }));
  }
  const ids = new Set();
  for (const node of nodes) {
    if (!fields(node, ['id', 'kind', 'roles', 'sourceRef']) || !text(node.id) || ids.has(node.id) || !text(node.kind)
      || !Array.isArray(node.roles) || node.roles.length > 16 || node.roles.some(role => !text(role))
      || !fields(node.sourceRef, ['sourceUnitId', 'span', 'coordinateUnit']) || node.sourceRef.coordinateUnit !== 'utf16') fail('qualified source role required');
    const source = sourceMap.get(node.sourceRef.sourceUnitId), span = node.sourceRef.span;
    if (!source || !Array.isArray(span) || span.length !== 2 || span.some(offset => !Number.isSafeInteger(offset) || offset < 0)
      || span[1] <= span[0] || span[1] > source.text.length || span.some(offset => offset > 0 && offset < source.text.length
        && /[\uD800-\uDBFF]/u.test(source.text[offset - 1]) && /[\uDC00-\uDFFF]/u.test(source.text[offset]))) fail('source role span unavailable');
    ids.add(node.id); metadataBytes += Buffer.byteLength(key(node));
    if (metadataBytes > 4 * 1024 * 1024) fail('role metadata allowance exceeded');
  }
  const relationIds = new Set();
  for (const relation of relations) {
    if (!fields(relation, ['id', 'kind', 'from', 'to', 'contextKey', 'certainty', 'evidenceId'])
      || !text(relation.id) || relationIds.has(relation.id) || !text(relation.kind) || !ids.has(relation.from) || !ids.has(relation.to)
      || relation.contextKey !== world.contextKey || !['exact-in-model', 'may', 'observed', 'heuristic'].includes(relation.certainty)
      || !text(relation.evidenceId)) fail('qualified directed relation required');
    relationIds.add(relation.id); metadataBytes += Buffer.byteLength(key(relation));
    if (metadataBytes > 4 * 1024 * 1024) fail('role metadata allowance exceeded');
  }
  const data = freeze(JSON.parse(key({ world, nodes, relations, coverage,
    sourceRoots: [...sourceMap.keys()].sort(), projection: 'supplied-source-role-facts/v1' })));
  const handle = Object.freeze({ viewId: semanticHash('pairofcleats.source-role-view.v1', data), world: data.world,
    coverage, nodeCount: nodes.length, relationCount: relations.length });
  views.set(handle, { ...data, sources: ownedSnapshots, byId: new Map(data.nodes.map(node => [node.id, node])) });
  return handle;
};

/** Independent map checker retains every parallel relation witness and leaves behavioral conditions open. */
export const checkSourceMotifMap = ({ view, motifId, roleMap }) => {
  const data = views.get(view), motif = motifs[motifId];
  if (!data || !motif || !fields(roleMap, motif.roles) || new Set(Object.values(roleMap)).size !== motif.roles.length) {
    return { status: 'rejected', reason: 'unknown-motif-or-noninjective-map' };
  }
  for (const role of motif.roles) if (!data.byId.get(roleMap[role])?.roles.includes(role)) return { status: 'rejected', reason: 'role-mismatch' };
  const witnesses = [];
  for (const [kind, fromRole, toRole] of motif.relations) {
    const found = data.relations.filter(relation => relation.kind === kind
      && relation.from === roleMap[fromRole] && relation.to === roleMap[toRole]);
    if (!found.length) return { status: 'rejected', reason: 'required-structural-relation-missing' };
    witnesses.push({ kind, fromRole, toRole, relations: found });
  }
  const match = freeze({ matchId: semanticHash('pairofcleats.source-motif-map.v1', { viewId: view.viewId, motifId, roleMap }),
    viewId: view.viewId, world: data.world, motifId, roleMap: JSON.parse(key(roleMap)), relationWitnesses: witnesses,
    sourceRefs: motif.roles.map(role => ({ role, entityId: roleMap[role], sourceRef: data.byId.get(roleMap[role]).sourceRef })),
    tier: 'checked-structural-correspondence', transfer: 'not-established',
    conditions: motif.conditions.map(id => ({ id, status: 'unknown', evidenceIds: [] })),
    sourceCoverage: data.coverage, behavioralEquivalence: 'not-implied' });
  matches.set(match, view);
  return { status: 'checked-structural', match };
};

/** Deterministic smallest-domain search; partial retained graphs never establish global absence. */
export const findSourceMotifs = ({ view, motifId, maxStates = 4096, maxMatches = 64, signal = null }) => {
  const data = views.get(view), motif = motifs[motifId];
  if (!data || !motif || !Number.isSafeInteger(maxStates) || maxStates < 0 || maxStates > 1000000
    || !Number.isSafeInteger(maxMatches) || maxMatches < 1 || maxMatches > 256) fail('bounded motif search required');
  const domains = new Map(motif.roles.map(role => [role, data.nodes.filter(node => node.roles.includes(role))
    .map(node => node.id).sort()]));
  const order = [...motif.roles].sort((a, b) => domains.get(a).length - domains.get(b).length || (a < b ? -1 : a > b ? 1 : 0));
  const results = [], roleMap = {}, used = new Set();
  let states = 0, reason = null;
  const search = depth => {
    if (signal?.aborted || states >= maxStates) { reason = signal?.aborted ? 'cancelled' : 'state-budget'; return; }
    states++;
    if (depth === order.length) {
      const checked = checkSourceMotifMap({ view, motifId, roleMap });
      if (checked.status === 'checked-structural') {
        if (results.length >= maxMatches) { reason = 'match-budget'; return; }
        results.push(checked.match);
      }
      return;
    }
    const role = order[depth];
    for (const entity of domains.get(role)) {
      if (signal?.aborted || states >= maxStates) { reason = signal?.aborted ? 'cancelled' : 'state-budget'; return; }
      states++;
      if (used.has(entity)) continue;
      roleMap[role] = entity; used.add(entity);
      const feasible = motif.relations.every(([kind, from, to]) => !roleMap[from] || !roleMap[to]
        || data.relations.some(relation => relation.kind === kind && relation.from === roleMap[from] && relation.to === roleMap[to]));
      if (feasible) search(depth + 1);
      used.delete(entity); delete roleMap[role];
      if (reason) return;
    }
  };
  search(0);
  return { viewId: view.viewId, motifId, matches: results, states, status: reason ? 'partial' : 'complete-in-retained-view',
    reason, sourceCoverage: data.coverage, globalAbsence: 'not-established', continuation: 'restart-same-immutable-view' };
};

/** Actual task-lens consumer: exact source facets plus unknown transfer checks, never an executable patch. */
export const materializeSourceMotifLens = ({ view, match, taskId, maxFacets = 12 }) => {
  const data = views.get(view);
  if (!data || matches.get(match) !== view) fail('owned checked motif match required');
  const lens = materializeTaskLens({ worldRef: data.world, taskId, maxFacets,
    sources: data.sources, requiredRoles: Object.keys(match.roleMap),
    candidates: match.sourceRefs.map(row => ({ id: row.role + ':' + row.entityId, worldRef: data.world,
      sourceRef: row.sourceRef, score: 1, roles: [row.role], mandatory: true,
      qualification: { certainty: 'checked-structural-correspondence', closure: data.coverage },
      reason: 'Source witness for the declared ' + row.role + ' role.' })),
    retainedResult: { ownerHandle: view.viewId, enumeration: data.coverage } });
  const payload = { ...lens, analogy: { matchId: match.matchId, motifId: match.motifId,
    conditions: match.conditions, transfer: 'not-established', actionAuthority: 'none' } };
  const measure = value => Buffer.byteLength(JSON.stringify(value) + '\n');
  let bytes = measure(payload);
  while (payload.renderedBytes !== bytes) { payload.renderedBytes = bytes; bytes = measure(payload); }
  enforceContextPackResponseBudget(payload, { measure });
  return payload;
};
