import assert from 'node:assert/strict';
import { causalValue, causalBinding, causalEquation, finiteCausalInput } from '../../helpers/finite-causal-model.js';
import { createFiniteCausalModel, describeFiniteCausalModel, evaluateFiniteCausalModel,
  readFiniteCausalModelInput } from '../../../src/graph/hypotheses/finite-model.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('graph/hypotheses/finite-causal-model/')[1];
assert.ok(['all-valuations-and-interventions', 'typed-domains-and-support', 'strict-equations-and-mass', 'ownership-and-cancellation'].includes(mode));
const evaluation = (model, value, intervention = []) => evaluateFiniteCausalModel(model, { modelId: model.modelId,
  exogenousAssignment: [causalBinding('U', value)], intervention });
const values = result => Object.fromEntries(result.values.map(row => [row.variableId, row.value.value]));
if (mode === 'all-valuations-and-interventions') {
  let compared = 0;
  for (let xFunction = 0; xFunction < 4; xFunction++) for (let yFunction = 0; yFunction < 16; yFunction++) {
    const input = finiteCausalInput();
    input.equations = [causalEquation('Y', ['U', 'X'], [false, true].flatMap(u => [false, true].map(x =>
      [[u, x], Boolean(yFunction & (1 << (Number(u) * 2 + Number(x))))]))),
    causalEquation('X', ['U'], [false, true].map(u => [[u], Boolean(xFunction & (1 << Number(u)))]))];
    input.variables.reverse(); const model = createFiniteCausalModel(input);
    for (const u of [false, true]) for (const x of [null, false, true]) for (const y of [null, false, true]) {
      // Independent relational oracle: enumerate all possible X,Y valuations,
      // then require the equations or their do-replacements simultaneously.
      const admissible = [];
      for (const vx of [false, true]) for (const vy of [false, true]) {
        const xExpected = x ?? Boolean(xFunction & (1 << Number(u)));
        const yExpected = y ?? Boolean(yFunction & (1 << (Number(u) * 2 + Number(vx))));
        if (vx === xExpected && vy === yExpected) admissible.push({ U: u, X: vx, Y: vy });
      }
      assert.equal(admissible.length, 1);
      const intervention = [...(x === null ? [] : [causalBinding('X', x)]), ...(y === null ? [] : [causalBinding('Y', y)])];
      const result = evaluation(model, u, intervention); assert.deepEqual(values(result), admissible[0]);
      assert.equal(result.trace.filter(row => row.mechanism === 'replaced-by-intervention').length, intervention.length);
      assert.equal(result.qualification, 'checked-in-supplied-model-not-observed-execution'); compared++;
    }
  }
  assert.equal(compared, 1152);
} else if (mode === 'typed-domains-and-support') {
  const input = finiteCausalInput();
  input.variables[1].domain = [causalValue(0), causalValue(1)]; input.variables[2].domain = [causalValue('quiet'), causalValue('published')];
  input.equations = [causalEquation('X', ['U'], [[[false], 0], [[true], 1]]),
    causalEquation('Y', ['X'], [[[0], 'quiet'], [[1], 'published']])];
  const model = createFiniteCausalModel(input), result = evaluation(model, false, [causalBinding('X', 1)]);
  assert.deepEqual(values(result), { U: false, X: 1, Y: 'published' });
  assert.deepEqual(result.trace.find(row => row.variableId === 'X').parents, []);
  assert.deepEqual(result.trace.find(row => row.variableId === 'Y').parents, ['X'], 'nonintervened descendants are recomputed');
  assert.throws(() => evaluation(model, false, [causalBinding('X', true)]), { code: 'ERR_FINITE_CAUSAL_CONTRACT' });
  const restricted = finiteCausalInput(); restricted.exogenousSupport.assignments.pop(); const one = createFiniteCausalModel(restricted);
  assert.throws(() => evaluation(one, true), { code: 'ERR_FINITE_CAUSAL_CONTRACT' });
  assert.throws(() => evaluation(one, false, [causalBinding('U', true)]), { code: 'ERR_FINITE_CAUSAL_CONTRACT' });
  const weighted = finiteCausalInput(); weighted.exogenousSupport.weighting = 'normalized-rational';
  weighted.exogenousSupport.assignments[0].weight = { numerator: '2', denominator: '6' };
  weighted.exogenousSupport.assignments[1].weight = { numerator: '4', denominator: '6' };
  const exact = createFiniteCausalModel(weighted); assert.equal(describeFiniteCausalModel(exact).support.weighting, 'normalized-rational');
  assert.notEqual(exact.modelId, createFiniteCausalModel(finiteCausalInput()).modelId, 'weight meaning participates in identity');
} else if (mode === 'strict-equations-and-mass') {
  for (const mutate of [input => { input.variables.push(structuredClone(input.variables[0])); },
    input => { input.variables[0].domain.push(causalValue(1)); }, input => { input.equations.pop(); },
    input => { input.equations.push(causalEquation('U', [], [[[], false]])); }, input => { input.equations[0].rows.pop(); },
    input => { input.equations[0].rows[1] = structuredClone(input.equations[0].rows[0]); },
    input => { input.equations[0].orderedParents = ['missing']; }, input => { input.equations[0].orderedParents = ['Y']; },
    input => { input.equations[0].rows[0].value = causalValue(1); }, input => { input.equations[0].evaluate = () => true; },
    input => { input.exogenousSupport.assignments.push(structuredClone(input.exogenousSupport.assignments[0])); },
    input => { input.exogenousSupport.assignments[0].values = []; }, input => { input.admissibleInterventionVariables = ['U']; },
    input => { input.assumptions[0].status = 'externally-supported'; },
    input => { input.exogenousSupport.weighting = 'normalized-rational'; },
    input => { input.exogenousSupport.assignments[0].weight = { numerator: '1', denominator: '1' }; }]) {
    const invalid = finiteCausalInput(); mutate(invalid); assert.throws(() => createFiniteCausalModel(invalid));
  }
  for (const weights of [[['1', '3'], ['1', '3']], [['-1', '2'], ['3', '2']], [['1', '0'], ['1', '1']]]) {
    const input = finiteCausalInput(); input.exogenousSupport.weighting = 'normalized-rational';
    input.exogenousSupport.assignments.forEach((row, index) => { row.weight = { numerator: weights[index][0], denominator: weights[index][1] }; });
    assert.throws(() => createFiniteCausalModel(input));
  }
  const partial = finiteCausalInput(); partial.exogenousSupport.state = 'partial'; partial.exogenousSupport.weighting = 'normalized-rational';
  partial.exogenousSupport.assignments.forEach(row => { row.weight = { numerator: '1', denominator: '2' }; });
  assert.throws(() => createFiniteCausalModel(partial), { code: 'ERR_FINITE_CAUSAL_CONTRACT' });
} else {
  const input = finiteCausalInput(), model = createFiniteCausalModel(input);
  input.equations[0].rows[0].value.value = true; assert.equal(values(evaluation(model, false)).X, false);
  assert.throws(() => readFiniteCausalModelInput(model).equations.pop(), TypeError);
  assert.throws(() => describeFiniteCausalModel({ ...model }), { code: 'ERR_FINITE_CAUSAL_HANDLE' });
  assert.throws(() => evaluateFiniteCausalModel(model, { modelId: '0'.repeat(64), exogenousAssignment: [causalBinding('U', false)], intervention: [] }), { code: 'ERR_FINITE_CAUSAL_MODEL_MISMATCH' });
  let reads = 0; const accessor = { ...finiteCausalInput(), get equations() { reads++; return []; } };
  assert.throws(() => createFiniteCausalModel(accessor)); assert.equal(reads, 0);
  const controller = new AbortController(); controller.abort();
  assert.throws(() => createFiniteCausalModel(finiteCausalInput(), { signal: controller.signal }), { name: 'AbortError' });
  assert.throws(() => evaluateFiniteCausalModel(model, { modelId: model.modelId, exogenousAssignment: [causalBinding('U', false)], intervention: [] },
    { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(describeFiniteCausalModel(model).qualification.causalTruth, 'not-established');
  const changed = finiteCausalInput(); changed.worldRef.traceRunId = '8'.repeat(64);
  assert.notEqual(createFiniteCausalModel(changed).worldId, model.worldId);
}
console.log('Finite causal lookup models agree with simultaneous valuation oracles without executing source or certifying causal truth.');
