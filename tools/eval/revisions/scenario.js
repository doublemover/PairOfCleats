import { canonicalSemanticJson, semanticHash } from '../../../src/index/semantic/identity.js';
import { captureRevisionOracle } from '../../../src/contracts/validators/revision-oracle.js';

export const revisionStateId = input => semanticHash('revision-oracle.input.v1', input, { maxBytes: 1024 * 1024 });
export const revisionScenarioId = input => semanticHash('revision-oracle.scenario.v1', input, { maxBytes: 1024 * 1024 });
export const revisionKey = input => canonicalSemanticJson(input, { maxBytes: 1024 * 1024 });
const fail = message => Object.assign(new TypeError(message), { code: 'ERR_REVISION_ORACLE_SCENARIO' });
const normalize = input => ({ ...input, supports: [...input.supports].sort((a, b) => a.originId < b.originId ? -1 : a.originId > b.originId ? 1 : 0) });
export const checkRevisionModel = input => {
  const facts = new Map(input.definition.facts.map(row => [row.id, row.kind]));
  if (facts.size !== input.definition.facts.length || new Set(input.definition.rules.map(row => row.id)).size !== input.definition.rules.length
    || [...facts.values()].filter(kind => kind === 'idb').length > 12
    || input.definition.rules.some(rule => facts.get(rule.head) !== 'idb' || rule.body.some(id => !facts.has(id)))
    || input.supports.some(row => facts.get(row.factId) !== 'edb' || row.sourceRef !== null)
    || new Set(input.supports.map(row => row.originId)).size !== input.supports.length) {
    throw fail('The finite revision profile requires declared positive facts/rules, at most twelve IDB facts and unique origin identities without source-authority claims.');
  }
};
export const applyRevisionEdit = (input, edit) => {
  const supports = new Map(input.supports.map(row => [row.originId, row]));
  for (const originId of edit.removeOriginIds) if (!supports.delete(originId)) throw fail('Revision removes an absent original support.');
  for (const row of edit.addSupports) {
    if (supports.has(row.originId)) throw fail('Revision adds an existing support identity.'); supports.set(row.originId, row);
  }
  const next = normalize({ ...input, supports: [...supports.values()] });
  if (next.supports.length > 64) throw fail('Revision exceeds retained support allowance.'); checkRevisionModel(next); return next;
};
/** Capture all transitions before any candidate execution. Source worlds are supplied
 * model coordinates; this profile has no source materialization or live authority. */
export const compileRevisionScenario = value => {
  const scenario = captureRevisionOracle('scenario', value), states = [normalize(scenario.input)]; checkRevisionModel(states[0]);
  const ids = new Set(['base']);
  for (const edit of scenario.revisions) {
    if (ids.has(edit.id)) throw fail('Duplicate revision identity.'); ids.add(edit.id);
    const before = states.at(-1);
    if (revisionStateId(before) !== edit.beforeId) throw fail('Revision precondition binds a different original state.');
    const next = applyRevisionEdit(before, edit);
    if (revisionStateId(next) !== edit.afterId) throw fail('Revision realized state disagrees with its declared hash.'); states.push(next);
  }
  return { scenario, states, scenarioId: revisionScenarioId(scenario) };
};
/** Internal generator/minimizer sealing: re-evaluate preconditions and retain exact
 * before/after identities. Never repair a supplied stale scenario on admission. */
export const sealRevisionEdits = (scenario, edits) => {
  let current = normalize(scenario.input); checkRevisionModel(current);
  const revisions = edits.map(edit => {
    const beforeId = revisionStateId(current); current = applyRevisionEdit(current, edit);
    return { id: edit.id, beforeId, afterId: revisionStateId(current), removeOriginIds: edit.removeOriginIds, addSupports: edit.addSupports };
  });
  return compileRevisionScenario({ ...scenario, revisions }).scenario;
};

export const generateRevisionScenario = ({ worldRef, family, seed = 0 }) => {
  if (!['join-cross-term', 'recursive-retraction', 'duplicate-supports', 'seeded-rules'].includes(family)
    || !Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw fail('Unsupported finite revision generator or seed.');
  const support = (factId, index) => ({ factId, originId: semanticHash('revision-oracle.origin.v1', { seed, index }), sourceRef: null });
  let edb = ['A', 'B'], idb = ['P'], rules = [{ id: 'join', head: 'P', body: ['A', 'B'] }], supports = [], edits;
  if (family === 'recursive-retraction') {
    edb = ['S']; idb = ['P', 'Q']; supports = [support('S', 0)];
    rules = [{ id: 'seed', head: 'P', body: ['S'] }, { id: 'pq', head: 'Q', body: ['P'] }, { id: 'qp', head: 'P', body: ['Q'] }];
    edits = [{ id: 'remove-seed', removeOriginIds: [supports[0].originId], addSupports: [] },
      { id: 'restore-seed', removeOriginIds: [], addSupports: supports }];
  } else if (family === 'duplicate-supports') {
    rules = [{ id: 'a', head: 'P', body: ['A'] }]; supports = [support('A', 0), support('A', 1)];
    edits = supports.map((row, index) => ({ id: 'remove-' + index, removeOriginIds: [row.originId], addSupports: [] }));
    edits.push({ id: 'restore', removeOriginIds: [], addSupports: [supports[0]] });
  } else if (family === 'seeded-rules') {
    idb = ['P', 'Q', 'R']; const names = [...edb, ...idb]; let state = seed;
    const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
    rules = Array.from({ length: 8 }, (_, index) => ({ id: 'rule-' + index, head: idb[next() % 3],
      body: [...new Set(Array.from({ length: next() % 4 }, () => names[next() % names.length]))] }));
    edits = [{ id: 'add-a', removeOriginIds: [], addSupports: [support('A', 0)] },
      { id: 'replace-a-b', removeOriginIds: [support('A', 0).originId], addSupports: [support('B', 1)] },
      { id: 'add-a-again', removeOriginIds: [], addSupports: [support('A', 0)] }];
  } else edits = [{ id: 'simultaneous-inputs', removeOriginIds: [], addSupports: [support('A', 0), support('B', 1)] },
    { id: 'remove-a', removeOriginIds: [support('A', 0).originId], addSupports: [] },
    { id: 'restore-a', removeOriginIds: [], addSupports: [support('A', 0)] }];
  return sealRevisionEdits({ schemaVersion: 1, profile: 'finite-positive-support-revisions-v1', family, seed,
    input: { worldRef, definition: { schemaVersion: 1, facts: [...edb.map(id => ({ id, kind: 'edb' })), ...idb.map(id => ({ id, kind: 'idb' }))], rules }, supports }, revisions: [] }, edits);
};
