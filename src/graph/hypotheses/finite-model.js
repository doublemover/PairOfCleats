import { performance } from 'node:perf_hooks';
import { canonicalSemanticJson, semanticHash } from '../../index/semantic/identity.js';
import { captureSemanticRequest } from '../../semantic/request-snapshot.js';
import { captureSourcePath } from '../../semantic/source-order.js';
import { throwIfAborted } from '../../shared/abort.js';
import { FINITE_CAUSAL_MODEL_SCHEMAS, FINITE_CAUSAL_MODEL_VERSION } from '../../contracts/schemas/finite-causal-model.js';
import { assertFiniteCausalModel } from '../../contracts/validators/finite-causal-model.js';
import { rationalZero, readRational, addRationals } from './rational.js';

const owned = new WeakMap();
const key = value => canonicalSemanticJson(value, { maxBytes: 1024 * 1024 });
const hash = (kind, value) => semanticHash('finite-causal.' + kind + '.v' + FINITE_CAUSAL_MODEL_VERSION, value, { maxBytes: 1024 * 1024 });
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const fail = (suffix, message) => Object.assign(new Error(message), { code: 'ERR_FINITE_CAUSAL_' + suffix });
const immutable = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) immutable(child); Object.freeze(value); } return value;
};
const capture = (kind, value) => {
  value = captureSemanticRequest(value, FINITE_CAUSAL_MODEL_SCHEMAS[kind]); assertFiniteCausalModel(kind, value); key(value); return value;
};
const get = handle => {
  const state = handle && typeof handle === 'object' ? owned.get(handle) : null;
  if (!state) throw fail('HANDLE', 'Original compiled finite causal model required.'); return state;
};
const bindings = (rows, variables, names = null) => {
  const map = new Map();
  for (const row of rows) {
    const variable = variables.get(row.variableId);
    if (!variable || map.has(row.variableId) || !variable.domain.some(value => key(value) === key(row.value))
      || names && !names.has(row.variableId)) throw fail('CONTRACT', 'Missing, duplicate, out-of-domain or out-of-scope variable binding.');
    map.set(row.variableId, row.value);
  }
  return map;
};
const assignmentKey = map => key([...map].sort(([a], [b]) => order(a, b)));

/** Acyclic deterministic lookup equations over a declared finite support.
 * Source bindings/assumption statuses are supplied metadata, not admissions.
 */
export const createFiniteCausalModel = (input, { signal = null } = {}) => {
  const began = performance.now(); throwIfAborted(signal); input = capture('model', input);
  const capturedAt = performance.now(), variables = new Map(), equations = new Map();
  for (const variable of input.variables) {
    if (variables.has(variable.id) || variable.domain.some(value => value.type !== variable.domain[0].type)
      || new Set(variable.domain.map(key)).size !== variable.domain.length) throw fail('CONTRACT', 'Variable identity and uniformly typed finite domain must be unique.');
    for (const source of variable.sourceBindings) {
      captureSourcePath(source.path);
      if (source.span[1] < source.span[0]) throw fail('CONTRACT', 'Source binding has reversed coordinates.');
    }
    variables.set(variable.id, variable);
  }
  const exogenous = new Set(input.variables.filter(variable => variable.kind === 'exogenous').map(variable => variable.id));
  for (const equation of input.equations) {
    throwIfAborted(signal);
    const output = variables.get(equation.output);
    if (!output || output.kind !== 'endogenous' || equations.has(output.id) || equation.orderedParents.some(id => !variables.has(id))) {
      throw fail('CONTRACT', 'Exactly one equation is required per endogenous variable, and none for exogenous variables.');
    }
    const parents = equation.orderedParents.map(id => variables.get(id));
    const combinations = parents.reduce((count, variable) => count * variable.domain.length, 1);
    if (combinations > 256) throw fail('UNSUPPORTED', 'A finite equation exceeds the admitted complete lookup-table domain.');
    const table = new Map();
    for (const row of equation.rows) {
      const rowKey = key(row.parentValues);
      if (table.has(rowKey) || row.parentValues.length !== parents.length
        || row.parentValues.some((value, index) => !parents[index].domain.some(item => key(item) === key(value)))
        || !output.domain.some(value => key(value) === key(row.value))) throw fail('CONTRACT', 'Equation rows must be unique total typed parent-to-output values.');
      table.set(rowKey, row.value);
    }
    if (table.size !== combinations) throw fail('CONTRACT', 'Incomplete finite equation table.');
    equations.set(output.id, { equation, table });
  }
  if (equations.size !== input.variables.length - exogenous.size) throw fail('CONTRACT', 'An endogenous equation is missing.');
  const ready = new Set(exogenous), topology = [], pending = new Set(equations.keys());
  while (pending.size) {
    const wave = [...pending].filter(id => equations.get(id).equation.orderedParents.every(parent => ready.has(parent))).sort(order);
    if (!wave.length) throw fail('UNSUPPORTED', 'Feedback/cyclic causal models require a separately declared semantics.');
    for (const id of wave) { pending.delete(id); ready.add(id); topology.push(id); }
  }
  for (const id of input.admissibleInterventionVariables) if (!equations.has(id)) throw fail('CONTRACT', 'Only explicitly admitted endogenous mechanisms may be replaced.');
  const supportKeys = new Set(); let mass = rationalZero();
  const weighted = input.exogenousSupport.weighting === 'normalized-rational';
  if (weighted && input.exogenousSupport.state !== 'complete') throw fail('CONTRACT', 'Normalized weights require a complete declared support.');
  for (const assignment of input.exogenousSupport.assignments) {
    throwIfAborted(signal);
    const map = bindings(assignment.values, variables, exogenous), id = assignmentKey(map);
    if (map.size !== exogenous.size || supportKeys.has(id) || weighted !== (assignment.weight !== null)) throw fail('CONTRACT', 'Support assignments require every exogenous variable once, without duplicates or mixed weight meanings.');
    supportKeys.add(id); if (weighted) mass = addRationals(mass, readRational(assignment.weight));
  }
  if (weighted && mass.numerator !== mass.denominator) throw fail('CONTRACT', 'Declared nonnegative rational weights must sum exactly to one.');
  if (new Set(input.assumptions.map(row => row.id)).size !== input.assumptions.length
    || input.assumptions.some(row => row.status === 'externally-supported' && !row.supportReceiptIds.length)) throw fail('CONTRACT', 'Assumption identities and supplied external-support references are incomplete.');
  const validatedAt = performance.now(), modelId = hash('model', input), worldId = hash('world', input.worldRef);
  const handle = Object.freeze({ modelId, worldId, questionId: input.questionId, version: FINITE_CAUSAL_MODEL_VERSION });
  const report = immutable({ schemaVersion: FINITE_CAUSAL_MODEL_VERSION, kind: 'finite-causal-model', modelId, worldId,
    questionId: input.questionId, worldRef: input.worldRef, variables: input.variables, assumptions: input.assumptions,
    evidencePartition: input.evidencePartition, support: { state: input.exogenousSupport.state, weighting: input.exogenousSupport.weighting,
      assignments: input.exogenousSupport.assignments.length }, topologicalOrder: topology,
    qualification: { evaluator: 'complete-deterministic-acyclic-lookup-in-declared-model', inputAuthority: 'supplied-not-revalidated',
      assumptions: 'supplied-status-not-certified-by-model', causalTruth: 'not-established', execution: 'none' } });
  owned.set(handle, { input, report, variables, equations, topology, exogenous, supportKeys,
    work: Object.freeze({ captureMs: capturedAt - began, validationMs: validatedAt - capturedAt, identityMs: performance.now() - validatedAt,
      elapsedMs: performance.now() - began, variables: variables.size, equationRows: input.equations.reduce((sum, row) => sum + row.rows.length, 0),
      retainedInputBytes: Buffer.byteLength(key(input)) }) });
  throwIfAborted(signal); return handle;
};
export const describeFiniteCausalModel = handle => get(handle).report;
export const readFiniteCausalModelInput = handle => get(handle).input;
export const finiteCausalModelWork = handle => get(handle).work;

/** Intervention replaces each admitted mechanism with a constant. It never
 * conditions the factual samples or freezes nonintervened descendants.
 */
export const evaluateFiniteCausalModel = (handle, request, { signal = null } = {}) => {
  const began = performance.now(), state = get(handle); throwIfAborted(signal); request = capture('evaluation', request);
  if (request.modelId !== handle.modelId) throw fail('MODEL_MISMATCH', 'Evaluation names a different finite model.');
  const values = bindings(request.exogenousAssignment, state.variables, state.exogenous);
  if (values.size !== state.exogenous.size || !state.supportKeys.has(assignmentKey(values))) throw fail('CONTRACT', 'Evaluation must use one assignment in the declared exogenous support.');
  const interventions = bindings(request.intervention, state.variables, new Set(state.input.admissibleInterventionVariables));
  const trace = [];
  for (const id of state.topology) {
    throwIfAborted(signal);
    const { equation, table } = state.equations.get(id), replaced = interventions.has(id);
    const parentValues = equation.orderedParents.map(parent => values.get(parent));
    const value = replaced ? interventions.get(id) : table.get(key(parentValues));
    if (value === undefined) throw fail('INTEGRITY', 'Compiled total equation did not contain its checked parent tuple.');
    values.set(id, value);
    trace.push({ variableId: id, operationalDefinitionId: state.variables.get(id).operationalDefinitionId,
      mechanism: replaced ? 'replaced-by-intervention' : 'declared-lookup', parents: replaced ? [] : equation.orderedParents,
      parentValues: replaced ? [] : parentValues, value });
  }
  const result = { schemaVersion: FINITE_CAUSAL_MODEL_VERSION, kind: 'finite-causal-valuation', modelId: handle.modelId,
    worldId: handle.worldId, valuationId: hash('valuation', { modelId: handle.modelId, request }),
    values: [...values].sort(([a], [b]) => order(a, b)).map(([variableId, value]) => ({ variableId, value })), trace,
    qualification: 'checked-in-supplied-model-not-observed-execution', work: { equationSteps: trace.length, elapsedMs: performance.now() - began } };
  if (Buffer.byteLength(JSON.stringify(result)) + 1 > 131072) throw fail('OUTPUT_LIMIT', 'Finite valuation exceeds its output allowance.');
  throwIfAborted(signal); return immutable(result);
};
