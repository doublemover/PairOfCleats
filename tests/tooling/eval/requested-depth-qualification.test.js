import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createEvaluationDepthPlan, assertCompatibleEvaluationDepthPlans } from '../../../tools/eval/depth-plan.js';

const runner = new URL('../../../tools/eval/run.js', import.meta.url).href;
const stubs = {
  '../shared/operator-cli-options.js': 'export const EVAL_OPTIONS = {};',
  'node:fs': 'export default {readFileSync(){return JSON.stringify(globalThis.evalDepthFixture.dataset);}};',
  '../../src/shared/cli.js': 'export const createCli = () => ({parse:()=>({dataset:"inert.json",top:globalThis.evalDepthFixture.top,backend:"memory","match-mode":"exact"})});',
  '../shared/cli-display.js': 'export const createToolDisplay = () => ({task(){return {set(){}};},close(){globalThis.evalDepthFixture.displayClosed++;},error(message){throw new Error(message);}});',
  '../../src/integrations/core/index.js': `export const search = async (root, options) => {
    const f=globalThis.evalDepthFixture, depth=Number(options.args[options.args.indexOf('-n')+1]);
    f.depths.push(depth);
    return Object.fromEntries(Object.entries(f.ranking).map(([mode,hits])=>[mode,hits.slice(0,depth)]));
  };`,
  '../../src/retrieval/sqlite-cache.js': 'export const createSqliteDbCache = () => ({retainFailure(){},pendingOwners(){return [];},dispose(){globalThis.evalDepthFixture.cacheClosed++;}});'
};
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.endsWith('/tools/eval/search-plan.js') && specifier === '../shared/dict-utils.js') {
    return { url: new URL('../../fixtures/benchmarks/evaluation-policy.js', import.meta.url).href, shortCircuit: true };
  }
  if (context.parentURL?.split('?')[0] === runner && Object.hasOwn(stubs, specifier)) {
    return { url: 'eval-depth-fixture:' + encodeURIComponent(specifier), shortCircuit: true };
  }
  return next(specifier, context);
}, load(url, context, next) {
  if (url.startsWith('eval-depth-fixture:')) return { format: 'module',
    source: stubs[decodeURIComponent(url.slice('eval-depth-fixture:'.length))], shortCircuit: true };
  return next(url, context);
} });
const originalLog = console.log;
const ranking = mode => Array.from({ length: 20 }, (_, id) => ({ id, file: `${mode}-${id + 1}.js`, name: `rank${id + 1}`, kind: 'FunctionDeclaration' }));
let run = 0;
try {
  const execute = async (top, dataset, ranks = { code: ranking('code') }) => {
    const fixture = { top, dataset, ranking: ranks, depths: [], lines: [], displayClosed: 0, cacheClosed: 0 };
    globalThis.evalDepthFixture = fixture; console.log = value => fixture.lines.push(value);
    await import(`${runner}?depth-qualification=${run++}`);
    assert.equal(fixture.cacheClosed, 1); assert.equal(fixture.displayClosed, 1);
    assert.ok(fixture.depths.every(depth => depth === top), 'reporting cannot expand retrieval beyond the selected depth');
    return JSON.parse(fixture.lines[0]);
  };
  const plans = [];
  for (const top of [1, 3, 5, 10, 20]) {
    const dataset = [1, 2, 4, 6, 11].map(rank => ({ query: 'relevant rank ' + rank, mode: 'code',
      relevant: [{ file: `code-${rank}.js` }], gold: [{ file: `code-${rank}.js` }] }));
    const report = await execute(top, dataset);
    plans.push(report.evaluationPlan);
    const expectedCutoffs = [...new Set([1, 3, 5, 10, top].filter(value => value <= top))].sort((a, b) => a - b);
    assert.deepEqual(report.ks, expectedCutoffs);
    assert.deepEqual(report.summary.evaluationPlan, report.evaluationPlan);
    assert.equal(report.evaluationPlan.reciprocalRank.name, `MRR@${top}`);
    assert.equal(report.evaluationPlan.reciprocalRank.cutoff, top);
    assert.equal(report.evaluationPlan.reciprocalRank.unobservedTail, 'censored');
    for (const [index, rank] of [1, 2, 4, 6, 11].entries()) {
      const row = report.results[index], cohort = row.cohorts[0];
      assert.deepEqual(Object.keys(row.metrics.recallAtK).map(Number), expectedCutoffs);
      assert.deepEqual(Object.keys(row.metrics.ndcgAtK).map(Number), expectedCutoffs);
      assert.equal(cohort.totals.relevant, 1); assert.equal(cohort.totals.gold, 1);
      assert.equal(cohort.depthCoverage.requestedDepth, top); assert.equal(cohort.depthCoverage.observedDepth, top);
      for (const k of expectedCutoffs) {
        assert.equal(row.metrics.recallAtK[k], rank <= k ? 1 : 0);
        assert.equal(row.metrics.ndcgAtK[k], rank <= k ? 1 / Math.log2(rank + 1) : 0);
        assert.equal(row.goldMetrics.recallAtK[k], row.metrics.recallAtK[k]);
      }
      assert.equal(row.metrics.mrr, rank <= top ? 1 / rank : 0);
      assert.equal(row.goldMetrics.mrr, row.metrics.mrr);
    }
    assertCompatibleEvaluationDepthPlans(report.evaluationPlan, JSON.parse(JSON.stringify(report.evaluationPlan)));
  }
  const short = await execute(10, [{ query: 'truly exhausted fixture', mode: 'code', relevant: [{ file: 'code-1.js' }] }],
    { code: ranking('code').slice(0, 1) });
  assert.equal(short.results[0].cohorts[0].depthCoverage.observedDepth, 1);
  assert.equal(short.results[0].cohorts[0].depthCoverage.window, 'short-response');
  assert.equal(short.results[0].cohorts[0].depthCoverage.exhaustion, 'unknown',
    'an independently exhausted fixture cannot grant exhaustion through an ordinary hit-array response');
  const mixed = await execute(3, [{ query: 'independently ranked modes', mode: 'all',
    relevant: [{ mode: 'code', file: 'code-2.js' }, { mode: 'prose', file: 'prose-6.js' }],
    gold: [{ mode: 'code', file: 'code-2.js' }, { mode: 'prose', file: 'prose-6.js' }] }],
  { code: ranking('code'), prose: ranking('prose'), extractedProse: [], records: [] });
  assert.equal(mixed.summary.mrr, 0.25); assert.equal(mixed.summary.recallAtK[3], 0.5);
  assert.equal(mixed.results[0].goldMetrics.mrr, 0.25);
  assert.throws(() => assertCompatibleEvaluationDepthPlans(plans[0], plans[1]), { code: 'ERR_EVAL_DEPTH_POLICY' });
  assert.throws(() => assertCompatibleEvaluationDepthPlans(plans[0], createEvaluationDepthPlan(1, 'substring')), { code: 'ERR_EVAL_DEPTH_POLICY' });
  assert.throws(() => assertCompatibleEvaluationDepthPlans(null, plans[0]), { code: 'ERR_EVAL_DEPTH_POLICY' });
  const forged = JSON.parse(JSON.stringify(plans[0])); forged.cutoffs.push(10);
  assert.throws(() => assertCompatibleEvaluationDepthPlans(forged, plans[0]), { code: 'ERR_EVAL_DEPTH_POLICY' });
} finally {
  hooks.deregister(); console.log = originalLog; delete globalThis.evalDepthFixture;
}
console.log('Live evaluation binds every metric cutoff and censored reciprocal rank to the requested retrieval depth.');
