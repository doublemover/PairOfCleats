import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { selectEvaluationCohort } from '../../../tools/eval/cohorts.js';
import { applyOutputBudgetPolicy } from '../../../src/retrieval/output/score-breakdown.js';

// Actual cohort/report consumers with inert search/filesystem/display seams.
const hit = { id: 1, file: 'fixture.ts', name: 'fixture', kind: 'FunctionDeclaration' };
const error = value => assert.equal(value.code, 'ERR_EVAL_RESPONSE');
for (const payload of [null, undefined, [], { ok: false, code: [], message: 'unavailable backend' },
  { ok: null, code: [] }, {}, { records: [] }, { code: null }, { code: {} }, { code: [null] }, { code: [false] },
  { code: [undefined] }, { code: [[hit]] }, { code: new Array(1) },
  { code: [], outputBudget: { truncated: true } },
  { code: [], outputBudget: { truncated: true, omittedHits: 1 } },
  { code: [hit], outputBudget: { truncated: false, omittedHits: 1 } }]) {
  assert.throws(() => selectEvaluationCohort(payload, 'code'), value => { error(value); return true; });
}
assert.deepEqual(selectEvaluationCohort({ code: [] }, 'code'), []);
assert.equal(selectEvaluationCohort({ ok: true, code: [hit] }, 'code')[0], hit);
assert.equal(selectEvaluationCohort({ code: [hit], outputBudget: { truncated: true, omittedHits: 0 } }, 'code')[0], hit,
  'metadata compaction with explicit zero hit omissions preserves judged-hit admission');
const compacted = applyOutputBudgetPolicy({ code: [hit], prose: [], extractedProse: [], records: [], stats: { detail: 'x'.repeat(6000) } },
  { totalMaxBytes: 2048 });
assert.equal(compacted.outputBudget.omittedHits, 0); assert.equal(selectEvaluationCohort(compacted, 'code').length, 1);
const omitted = applyOutputBudgetPolicy({ code: Array.from({ length: 64 }, (_, id) => ({ ...hit, id, file: `fixture-${id}.ts` })),
  prose: [], extractedProse: [], records: [] }, { totalMaxBytes: 2048 });
assert(omitted.outputBudget.omittedHits > 0);
assert.throws(() => selectEvaluationCohort(omitted, 'code'), /omitted hits/,
  'actual render-budget hit removal cannot be scored as retrieval misses');

const runner = new URL('../../../tools/eval/run.js', import.meta.url).href;
const stubs = {
  '../shared/operator-cli-options.js': 'export const EVAL_OPTIONS = {};',
  'node:fs': 'export default {readFileSync(){return JSON.stringify(globalThis.evalResponseFixture.dataset);}};',
  '../../src/shared/cli.js': 'export const createCli = () => ({parse:()=>({dataset:"inert.json",top:10,backend:"memory"})});',
  '../shared/cli-display.js': 'export const createToolDisplay = () => ({task(){return {set(){}};},close(){globalThis.evalResponseFixture.displayClosed++;},error(message){throw new Error(message);}});',
  '../../src/integrations/core/index.js': `export const search = async (root, options) => {
    globalThis.evalResponseFixture.calls.push({root,query:options.query,args:[...options.args]});
    return globalThis.evalResponseFixture.payload;
  };`,
  '../../src/retrieval/sqlite-cache.js': `export const createSqliteDbCache = () => ({retainFailure(){},pendingOwners(){return [];},dispose(){
    const fixture=globalThis.evalResponseFixture; fixture.cacheClosed++;
    if(Object.hasOwn(fixture,'cleanupError'))throw fixture.cleanupError;
  }});`
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.split('?')[0] === runner && Object.hasOwn(stubs, specifier)) return {
      url: `eval-response-fixture:${encodeURIComponent(specifier)}`, shortCircuit: true
    };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('eval-response-fixture:')) return { format: 'module', source: stubs[decodeURIComponent(url.slice('eval-response-fixture:'.length))], shortCircuit: true };
    return next(url, context);
  }
});
const originalLog = console.log;
let run = 0;
try {
  const execute = async (mode, payload, relevant, overrides = {}) => {
    const fixture = { dataset: [{ query: 'fixture', mode, relevant }], payload, calls: [], lines: [], cacheClosed: 0, displayClosed: 0, ...overrides };
    globalThis.evalResponseFixture = fixture; console.log = value => fixture.lines.push(value);
    return { fixture, report: import(`${runner}?response-admission=${run++}`) };
  };
  for (const invalid of [{}, { ok: false, code: [] }, { records: null }, { records: [], outputBudget: { truncated: true, omittedHits: 2 } }]) {
    const { fixture, report } = await execute('records', invalid, [{ file: 'fixture.ts' }]);
    await assert.rejects(report, value => value.code === 'ERR_EVAL_RESPONSE');
    assert.equal(fixture.calls.length, 1); assert.deepEqual(fixture.lines, [], 'unavailable evidence cannot publish ordinary zero-quality metrics');
    assert.equal(fixture.cacheClosed, 1); assert.equal(fixture.displayClosed, 1);
  }
  const zero = await execute('records', { records: [] }, [{ file: 'fixture.ts' }]); await zero.report;
  const zeroReport = JSON.parse(zero.fixture.lines[0]);
  assert.equal(zeroReport.results[0].totals.hits, 0); assert.equal(zeroReport.summary.recallAtK[1], 0);
  assert.equal(zero.fixture.cacheClosed, 1); assert.equal(zero.fixture.displayClosed, 1);
  const complete = await execute('all', { code: [], prose: [], extractedProse: [], records: [hit] }, [{ mode: 'records', file: 'fixture.ts' }]); await complete.report;
  assert.equal(JSON.parse(complete.fixture.lines[0]).summary.recallAtK[1], 1);
  const missing = await execute('all', { code: [], prose: [], records: [hit] }, [{ mode: 'records', file: 'fixture.ts' }]);
  await assert.rejects(missing.report, /selected extracted-prose/); assert.deepEqual(missing.fixture.lines, []);
  const cleanupError = Object.freeze(new Error('actual entry cleanup refused'));
  const cleanup = await execute('records', { records: [] }, [], { cleanupError });
  await assert.rejects(cleanup.report, value => value === cleanupError);
  assert.deepEqual(cleanup.fixture.lines, [], 'cleanup must finish before metrics can be published');
  assert.equal(cleanup.fixture.cacheClosed, 1); assert.equal(cleanup.fixture.displayClosed, 1);
} finally {
  hooks.deregister(); console.log = originalLog; delete globalThis.evalResponseFixture;
}
console.log('Actual eval response/selected-cohort/output-retention controls authored; execution deferred.');
