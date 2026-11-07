import { createAjv, compileSchema } from '../../../src/shared/validation/ajv-factory.js';
import { captureSemanticRequest } from '../../../src/semantic/request-snapshot.js';
import { SUGGESTION_REVISION_PROFILE, SUGGESTION_REVISION_SCENARIO_SCHEMA } from '../../../src/contracts/schemas/revision-suggestions.js';
import { revisionScenarioId } from './scenario.js';
import { snapshotPlainData } from '../../../src/shared/plain-data-snapshot.js';

const validate = compileSchema(createAjv({ strict: true, allErrors: true }), SUGGESTION_REVISION_SCENARIO_SCHEMA);
export const suggestionScenarioError = message => Object.assign(new TypeError(message), { code: 'ERR_SUGGESTION_REVISION_SCENARIO' });
export const suggestionStateId = state => revisionScenarioId({ profile: SUGGESTION_REVISION_PROFILE, state });
const order = values => [...values].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
const normalize = input => ({ nodes: order(input.nodes), edges: [...input.edges].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  testPaths: order(input.testPaths), changedPaths: order(input.changedPaths) });
const check = input => {
  const state = normalize(input), nodes = new Set(state.nodes), edges = new Set(state.edges.map(row => row.id));
  if (nodes.size !== state.nodes.length || edges.size !== state.edges.length || state.nodes.length > 12 || state.edges.length > 64
    || [...state.testPaths, ...state.changedPaths].some(path => !nodes.has(path))
    || state.edges.some(edge => !nodes.has(edge.from) || !nodes.has(edge.to))) throw suggestionScenarioError('Original edge supports, tests and changes require unique admitted finite node identities.');
  return state;
};
const apply = (state, edit) => {
  const nodes = new Set(state.nodes), edges = new Map(state.edges.map(edge => [edge.id, edge]));
  for (const path of edit.removeNodes) if (!nodes.delete(path)) throw suggestionScenarioError('Cannot remove an absent node.');
  for (const path of edit.addNodes) { if (nodes.has(path)) throw suggestionScenarioError('Cannot add an existing node.'); nodes.add(path); }
  for (const id of edit.removeEdgeIds) if (!edges.delete(id)) throw suggestionScenarioError('Cannot remove an absent original edge support.');
  for (const edge of edit.addEdges) { if (edges.has(edge.id)) throw suggestionScenarioError('Cannot replace an original edge support.'); edges.set(edge.id, edge); }
  return check({ nodes: [...nodes], edges: [...edges.values()], testPaths: edit.testPaths, changedPaths: edit.changedPaths });
};
export const compileSuggestionRevisionScenario = value => {
  const passive = snapshotPlainData(value, { maxBytes: 524288, maxDepth: 12, maxNodes: 20000, maxItems: 128,
    code: 'ERR_SUGGESTION_REVISION_SCENARIO', label: 'Test-suggestion revision scenario', nullPrototype: false });
  const scenario = captureSemanticRequest(passive, SUGGESTION_REVISION_SCENARIO_SCHEMA);
  if (!validate(scenario)) throw suggestionScenarioError('Invalid closed test-suggestion revision scenario.');
  const states = [check(scenario.initial)], ids = new Set(['base']), supports = new Map();
  const remember = state => {
    for (const edge of state.edges) {
      const original = supports.get(edge.id);
      if (original && (original.from !== edge.from || original.to !== edge.to)) throw suggestionScenarioError('A retired original edge identity cannot acquire another payload.');
      supports.set(edge.id, edge);
    }
  };
  remember(states[0]);
  for (const edit of scenario.revisions) {
    if (ids.has(edit.id) || edit.beforeId !== suggestionStateId(states.at(-1))) throw suggestionScenarioError('Duplicate checkpoint or stale suggestion graph precondition.');
    ids.add(edit.id); const next = apply(states.at(-1), edit); remember(next);
    if (edit.afterId !== suggestionStateId(next)) throw suggestionScenarioError('Realized graph does not match the declared original state.'); states.push(next);
  }
  return { scenario, states, scenarioId: revisionScenarioId(scenario) };
};
export const sealSuggestionRevisionEdits = (scenario, edits) => {
  let state = check(scenario.initial);
  const revisions = edits.map(edit => {
    const beforeId = suggestionStateId(state); state = apply(state, edit);
    return { id: edit.id, beforeId, afterId: suggestionStateId(state), removeNodes: edit.removeNodes, addNodes: edit.addNodes,
      removeEdgeIds: edit.removeEdgeIds, addEdges: edit.addEdges, testPaths: edit.testPaths, changedPaths: edit.changedPaths };
  });
  return compileSuggestionRevisionScenario({ ...scenario, revisions }).scenario;
};
/** Data-only grammar: no commands, caller functions, disk discovery or source
 * execution. Edge support identities survive duplicate projection/retraction. */
export const generateSuggestionRevisionScenario = ({ repositoryNamespace, family, seed = 0 }) => {
  if (!['duplicate-retraction', 'negative-reactivation', 'cycle-shortcut', 'node-and-test-replacement', 'seeded-imports'].includes(family)
    || !Number.isSafeInteger(seed) || seed < 0 || seed > 4294967295) throw suggestionScenarioError('Unsupported suggestion generator family or seed.');
  const a = 'src/u0.js', b = 'src/u1.js', t = 'tests/t0.test.js', u = 'tests/t1.test.js';
  const edge = (id, from, to) => ({ id, from, to });
  let initial = { nodes: [a, b, t, u], edges: [edge('ta', t, a), edge('ut', u, t)], testPaths: [t, u], changedPaths: [a] };
  const edit = (id, fields) => ({ id, removeNodes: [], addNodes: [], removeEdgeIds: [], addEdges: [], testPaths: initial.testPaths, changedPaths: initial.changedPaths, ...fields });
  let edits;
  if (family === 'duplicate-retraction') {
    initial.edges.push(edge('taDuplicate', t, a));
    edits = [edit('remove-one', { removeEdgeIds: ['ta'] }), edit('remove-last', { removeEdgeIds: ['taDuplicate'] }), edit('restore', { addEdges: [edge('ta', t, a)] })];
  } else if (family === 'negative-reactivation') {
    initial.edges = [];
    edits = [edit('new-route', { addEdges: [edge('tb', t, b), edge('ba', b, a)] }), edit('cut-route', { removeEdgeIds: ['ba'] }),
      edit('restore-route', { addEdges: [edge('ba', b, a)] }), edit('different-change', { changedPaths: [u] })];
  } else if (family === 'cycle-shortcut') {
    initial.edges.push(edge('ab', a, b), edge('ba', b, a));
    edits = [edit('shortcut', { addEdges: [edge('ua', u, a)] }), edit('remove-shortcut', { removeEdgeIds: ['ua'] }), edit('test-is-seed', { changedPaths: [t] })];
  } else if (family === 'node-and-test-replacement') {
    const moved = 'checks/t2.test.js';
    edits = [edit('replace-test', { removeNodes: [u], removeEdgeIds: ['ut'], addNodes: [moved], addEdges: [edge('movedT', moved, t)], testPaths: [t, moved] }),
      edit('restore-old-test', { addNodes: [u], addEdges: [edge('ut', u, t)], testPaths: [t, u, moved] }),
      edit('empty-tests', { testPaths: [] }), edit('restore-tests', {})];
  } else {
    const nodes = Array.from({ length: 8 }, (_, i) => i < 4 ? `src/u${i}.js` : `tests/t${i - 4}.test.js`);
    let random = seed;
    const next = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random; };
    initial = { nodes, edges: Array.from({ length: 24 }, (_, i) => edge('edge' + i, nodes[(next() >>> 16) % nodes.length], nodes[(next() >>> 16) % nodes.length])),
      testPaths: nodes.slice(4), changedPaths: nodes.slice(0, 2) };
    edits = [edit('remove-some', { removeEdgeIds: initial.edges.slice(0, 8).map(row => row.id) }),
      edit('restore-some', { addEdges: initial.edges.slice(0, 8) }), edit('new-seeds', { changedPaths: nodes.slice(2, 4) })];
  }
  return sealSuggestionRevisionEdits({ schemaVersion: 1, profile: SUGGESTION_REVISION_PROFILE, repositoryNamespace, family, seed, initial, revisions: [] }, edits);
};
