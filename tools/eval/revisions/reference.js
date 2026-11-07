import { throwIfAborted } from '../../../src/shared/abort.js';
import { captureRevisionOracle } from '../../../src/contracts/validators/revision-oracle.js';
import { checkRevisionModel, compileRevisionScenario, revisionKey } from './scenario.js';

/** Independent model-theoretic oracle. Enumerate every IDB valuation and intersect
 * all Horn-closed models with the exact supplied EDB. This imports no candidate
 * extraction, propagation, fixedpoint, support hashing or score implementation. */
export const evaluateRevisionReference = (input, { signal = null, maxValuations = 4096, check = () => true } = {}) => {
  input = captureRevisionOracle('input', input); checkRevisionModel(input);
  if (!Number.isSafeInteger(maxValuations) || maxValuations < 1 || maxValuations > 4096) throw new RangeError('Invalid finite oracle valuation allowance.');
  const facts = input.definition.facts, idb = facts.filter(row => row.kind === 'idb'), extensional = new Set(input.supports.map(row => row.factId));
  const total = 2 ** idb.length;
  let closed = 0, intersection = null;
  for (let mask = 0; mask < total; mask++) {
    throwIfAborted(signal);
    if (mask >= maxValuations || !check()) return { state: 'unknown', reason: 'reference-work-budget', valuations: mask, output: null };
    const model = new Set(extensional);
    for (let bit = 0; bit < idb.length; bit++) if (mask & (2 ** bit)) model.add(idb[bit].id);
    let admissible = true;
    for (const rule of input.definition.rules) {
      let bodyTrue = true;
      for (const premise of rule.body) if (!model.has(premise)) { bodyTrue = false; break; }
      if (bodyTrue && !model.has(rule.head)) { admissible = false; break; }
    }
    if (!admissible) continue;
    closed++;
    if (intersection === null) intersection = model;
    else for (const fact of intersection) if (!model.has(fact)) intersection.delete(fact);
  }
  if (!closed) throw new Error('Finite positive oracle has no closed model.');
  const output = { complete: true, facts: facts.map(fact => {
    const producers = [];
    for (const row of input.supports) if (row.factId === fact.id) producers.push({ kind: 'extensional-support', originId: row.originId, body: [] });
    for (const rule of input.definition.rules) if (rule.head === fact.id && rule.body.every(id => intersection.has(id))) {
      producers.push({ kind: 'grounded-rule-instance', originId: null, body: [...rule.body].sort() });
    }
    return { id: fact.id, present: intersection.has(fact.id), producers };
  }) };
  return { state: 'complete', reason: null, valuations: total, output: normalizeRevisionOutput(output) };
};

export const normalizeRevisionOutput = value => {
  const output = captureRevisionOracle('output', value);
  if (new Set(output.facts.map(row => row.id)).size !== output.facts.length) throw new TypeError('Duplicate oracle output fact identity.');
  return { complete: output.complete, facts: output.facts.map(row => ({ ...row, producers: row.producers.map(producer => ({ ...producer, body: [...producer.body].sort() }))
    .sort((a, b) => revisionKey(a) < revisionKey(b) ? -1 : revisionKey(a) > revisionKey(b) ? 1 : 0) })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) };
};

/** Data-only comparison seam is also used by seeded defect controls. A copied
 * report is a diagnostic input, never an original execution or qualified receipt. */
export const compareRevisionOutputs = ({ scenario, checkpoint, actual, oracleOptions = {} }) => {
  const compiled = compileRevisionScenario(scenario);
  if (!Number.isInteger(checkpoint) || checkpoint < 0 || checkpoint >= compiled.states.length) throw new RangeError('Invalid revision checkpoint.');
  const reference = evaluateRevisionReference(compiled.states[checkpoint], oracleOptions);
  if (reference.state !== 'complete') return { outcome: 'unknown', reason: reference.reason, differences: [], valuations: reference.valuations };
  actual = normalizeRevisionOutput(actual);
  if (!actual.complete) return { outcome: 'unknown', reason: 'candidate-incomplete', differences: [], valuations: reference.valuations };
  const expected = reference.output, differences = [];
  for (const id of new Set([...expected.facts.map(row => row.id), ...actual.facts.map(row => row.id)])) {
    const before = expected.facts.find(row => row.id === id) ?? null, after = actual.facts.find(row => row.id === id) ?? null;
    if (revisionKey(before) !== revisionKey(after)) differences.push({ id, expected: before, actual: after });
  }
  return { outcome: differences.length ? 'fail' : 'pass', reason: differences.length ? 'finite-model-disagreement' : null,
    differences, valuations: reference.valuations };
};
