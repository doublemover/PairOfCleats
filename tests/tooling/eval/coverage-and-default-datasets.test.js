import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { captureEvaluationDatasetCases } from '../../../tools/eval/dataset-admission.js';
import { resolveEvaluationCohorts } from '../../../tools/eval/cohorts.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/eval/coverage-and-default-datasets/')[1];
if (selected === 'datasets') {
  for (const filename of ['tools/eval/sample.json', 'tests/fixtures/sample/eval.json',
    'tests/fixtures/eval/triplecleat-bakeoff.json', 'tests/fixtures/mixed/eval.json', 'tests/fixtures/pairofcleats-search-showcase/eval.json']) {
    const dataset = JSON.parse(await fs.readFile(filename, 'utf8'));
    const cases = captureEvaluationDatasetCases(dataset); assert.equal(cases.length, dataset.length);
    for (const row of cases) {
      const plan = resolveEvaluationCohorts(row.mode, [...row.silver, ...row.gold]);
      assert.ok(plan.modes.length);
      for (const label of [...row.silver, ...row.gold]) if (plan.modes.length > 1) {
        assert.ok(plan.modes.includes(label.mode), `${filename} ${row.query} must explicitly identify every intended cohort`);
      }
    }
    const guide = cases.find(row => row.query === 'guide');
    if (guide) assert.ok([...guide.silver, ...guide.gold].every(row => row.mode === 'prose'));
  }
  assert.throws(() => resolveEvaluationCohorts('prose', [{ file: 'docs/guide.md' }]), /explicit mode/);
} else {
  assert.equal(selected, 'runner');
  const runner = new URL('../../../tools/eval/run.js', import.meta.url).href;
  let current;
  const key = Symbol.for('poc.eval.coverage');
  const hooks = registerHooks({ resolve(specifier, context, next) {
    const parent = context.parentURL?.split('?')[0];
    if (parent === runner && specifier === 'node:fs') return { url: 'coverage:fs', shortCircuit: true };
    if (parent === runner && specifier.endsWith('/cli.js')) return { url: 'coverage:cli', shortCircuit: true };
    if (parent === runner && specifier.endsWith('/cli-display.js')) return { url: 'coverage:display', shortCircuit: true };
    if (parent === runner && specifier.endsWith('/core/index.js')) return { url: 'coverage:search', shortCircuit: true };
    if (parent === runner && specifier.endsWith('/sqlite-cache.js')) return { url: 'coverage:cache', shortCircuit: true };
    if (parent?.endsWith('/tools/eval/search-plan.js') && specifier === '../shared/dict-utils.js') return { url: 'coverage:policy', shortCircuit: true };
    return next(specifier, context);
  }, load(url, context, next) {
    const sources = {
      'coverage:fs': `export default {readFileSync(){return JSON.stringify(globalThis[Symbol.for('poc.eval.coverage')].dataset);}};`,
      'coverage:cli': 'export const createCli=()=>({parse:()=>({dataset:"fixture.json",top:5,backend:"memory","match-mode":"exact"})});',
      'coverage:display': 'export const createToolDisplay=()=>({task:()=>({set(){}}),close(){},error(message){throw new Error(message);}});',
      'coverage:cache': 'export const createSqliteDbCache=()=>({retainFailure(){},pendingOwners:()=>[],dispose(){}});',
      'coverage:search': `export const search=async(root,options)=>globalThis[Symbol.for('poc.eval.coverage')].responses[options.query];`,
      'coverage:policy': `export const loadUserConfig=()=>({});export const getAutoPolicy=async()=>({quality:{value:'balanced'},retrieval:{backend:'memory'}});
        export const getModelConfig=()=>({id:'fixture'});export const getDictConfig=()=>({});export const getMetricsDir=()=>'.';`
    };
    return sources[url] ? { format: 'module', source: sources[url], shortCircuit: true } : next(url, context);
  } });
  const log = console.log; let ordinal = 0;
  const execute = async (dataset, responses) => {
    current = { dataset, responses, lines: [] }; globalThis[key] = current;
    console.log = value => current.lines.push(value);
    await import(`${runner}?judgment-coverage=${ordinal++}`);
    return JSON.parse(current.lines[0]);
  };
  const hit = mode => ({ file: `${mode}.txt`, chunkUid: `${mode}:1`, start: 0, end: 1 });
  try {
    const dataset = Array.from({ length: 10 }, (_, i) => ({ query: `q${i}`, mode: 'code', ...(i === 0 ? { relevant: [{ file: 'code.txt' }] } : {}) }));
    const report = await execute(dataset, Object.fromEntries(dataset.map(row => [row.query, { code: [hit('code')] }])));
    assert.equal(report.schemaVersion, 3); assert.equal(report.summary.cases, 10); assert.equal(report.summary.mrr, 1);
    const silver = report.summary.judgmentCoverage.silver;
    assert.equal(silver.eligibleCases, 1); assert.equal(silver.observedCases, 1); assert.equal(silver.unjudgedCases, 9);
    assert.equal(silver.observedCohorts, 1); assert.equal(silver.unjudgedCohorts, 9);
    for (const k of [1, 3, 5]) { assert.equal(silver.metricCoverage.recallAtK[k].observedCases, 1); assert.equal(report.summary.recallAtK[k], 1); }
    assert.equal(report.summary.judgmentCoverage.gold.availability, 'unavailable-no-judgments');
    const gold = await execute([{ query: 'gold', mode: 'code', gold: [{ file: 'code.txt' }] }], { gold: { code: [hit('code')] } });
    assert.equal(gold.summary.mrr, null); assert.equal(gold.summary.recallAtK[5], null);
    assert.equal(gold.summary.judgmentCoverage.gold.metrics.mrr, 1); assert.equal(gold.summary.judgmentCoverage.gold.observedCases, 1);
    const zero = await execute([{ query: 'zero', mode: 'code', relevant: [{ file: 'missing.txt' }] }], { zero: { code: [] } });
    assert.equal(zero.summary.mrr, 0); assert.equal(zero.summary.judgmentCoverage.silver.observedCases, 1);
    const unknown = await execute([{ query: 'unjudged', mode: 'code' }], { unjudged: { code: [] } });
    assert.equal(unknown.summary.mrr, null); assert.equal(unknown.summary.judgmentCoverage.silver.observedCases, 0);
    const mixed = await execute([{ query: 'mixed', mode: 'prose', relevant: [{ mode: 'prose', file: 'prose.txt' },
      { mode: 'extracted-prose', file: 'absent.txt' }] }], { mixed: { prose: [hit('prose')], extractedProse: [hit('extracted-prose')] } });
    assert.equal(mixed.summary.mrr, 0.5); assert.equal(mixed.summary.judgmentCoverage.silver.observedCohorts, 2);
    assert.equal(mixed.summary.judgmentCoverage.silver.observedCases, 1);
  } finally { hooks.deregister(); console.log = log; delete globalThis[key]; }
}
console.log('Complete shipped datasets and actual evaluator preserve explicit cohort labels and silver/gold measurement denominators: ' + selected);
