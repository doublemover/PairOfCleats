import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { makeTaskSpanTrace, taskTraceFixtureHash as hash, TASK_TRACE_FIXTURE_QUERY as query } from '../../helpers/task-span-trace-fixture.js';

// Execute the actual existing report entry with inert search/filesystem/display
// boundaries. Optional trace labels must never reach a search request.
const runner = new URL('../../../tools/eval/run.js', import.meta.url).href;
const stubs = {
  '../shared/operator-cli-options.js': 'export const EVAL_OPTIONS = {};',
  'node:fs': 'export default {readFileSync(){return JSON.stringify(globalThis.taskSpanRunnerFixture.dataset);}};',
  '../../src/shared/cli.js': 'export const createCli = () => ({parse:()=>globalThis.taskSpanRunnerFixture.argv});',
  '../shared/cli-display.js': 'export const createToolDisplay = () => ({task(){return {set(){}};},close(){globalThis.taskSpanRunnerFixture.lifetimes.push("display-close");},error(message){throw new Error(message);}});',
  '../../src/integrations/core/index.js': `export const search = async (root, options) => {
    if(globalThis.taskSpanRunnerFixture.lifetimes.includes('cache-dispose')) throw new Error('Search after cache disposal');
    globalThis.taskSpanRunnerFixture.lifetimes.push('search');
    globalThis.taskSpanRunnerFixture.calls.push({root,query:options.query,args:[...options.args]});
    return {code:[{file:'first/shared.ts',name:'fixture',score:1}]};
  };`,
  '../../src/retrieval/sqlite-cache.js': 'export const createSqliteDbCache = () => ({dispose(){globalThis.taskSpanRunnerFixture.lifetimes.push("cache-dispose");},retainFailure(error){globalThis.taskSpanRunnerFixture.retainedFailures.push(error);},pendingOwners(){return [];}});'
};
const replayModules = new Map([
  ['./vector-oracle.js', 'evaluateDatasetVectorReplay'], ['./fusion-replay.js', 'evaluateDatasetFusionReplay'],
  ['./shadow-routing.js', 'evaluateDatasetShadowRouting'], ['./task-spans.js', 'evaluateDatasetTaskSpans'],
  ['./interventions/dataset.js', 'evaluateDatasetInterventions']
]);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/tools/eval/search-plan.js') && specifier === '../shared/dict-utils.js') {
      return { url: new URL('../../fixtures/benchmarks/evaluation-policy.js', import.meta.url).href, shortCircuit: true };
    }
    if (context.parentURL?.split('?')[0] === runner && Object.hasOwn(stubs, specifier)) return {
      url: `task-span-fixture:${encodeURIComponent(specifier)}`, shortCircuit: true
    };
    if (context.parentURL?.split('?')[0] === runner && replayModules.has(specifier)) return {
      url: `task-span-replay:${encodeURIComponent(specifier)}`, shortCircuit: true
    };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('task-span-fixture:')) return { format: 'module', source: stubs[decodeURIComponent(url.slice('task-span-fixture:'.length))], shortCircuit: true };
    if (url.startsWith('task-span-replay:')) {
      const specifier = decodeURIComponent(url.slice('task-span-replay:'.length)), name = replayModules.get(specifier);
      const target = JSON.stringify(new URL(specifier, runner).href);
      return { format: 'module', source: `export * from ${target}; import {${name} as original} from ${target};
        export const ${name} = (...args) => {
          const fixture=globalThis.taskSpanRunnerFixture;
          if(!fixture.lifetimes.includes('cache-dispose') || !fixture.lifetimes.includes('display-close')) throw new Error('Replay retained live resources');
          fixture.lifetimes.push(${JSON.stringify(name)});
          if(Object.hasOwn(fixture,'offlineFailure')) throw fixture.offlineFailure;
          return original(...args);
        };`, shortCircuit: true };
    }
    return next(url, context);
  }
});
const log = console.log;
try {
  const execute = async (dataset, id, options = {}) => {
    const fixture = { dataset, calls: [], argv: { dataset: 'inert-task-trace.json', top: 10, backend: 'memory' }, lines: [], lifetimes: [], retainedFailures: [], ...options };
    globalThis.taskSpanRunnerFixture = fixture;
    console.log = value => fixture.lines.push(value);
    try { await import(`${runner}?task-span-fixture=${id}`); }
    finally {
      assert.deepEqual(fixture.lifetimes.slice(0, 3), ['search', 'cache-dispose', 'display-close']);
      assert.equal(fixture.lifetimes.filter(value => value === 'cache-dispose').length, 1);
      assert.equal(fixture.lifetimes.filter(value => value === 'display-close').length, 1);
      assert.deepEqual(fixture.retainedFailures, [], 'saved-data failures cannot become native-cache prerequisites');
    }
    assert.equal(fixture.lines.length, 1);
    return { report: JSON.parse(fixture.lines[0]), calls: fixture.calls };
  };
  const entry = { query, mode: 'code', relevant: [{ file: 'first/shared.ts' }] };
  const ordinary = await execute([entry], 'ordinary');
  const traced = await execute([{ ...entry, taskTrace: makeTaskSpanTrace() }], 'traced');
  assert.deepEqual(traced.calls, ordinary.calls, 'saved labels/spans cannot alter provider arguments, search count or query');
  const { taskSpanReplay, generatedAt: tracedAt, ...tracedPrimary } = traced.report;
  const { generatedAt: ordinaryAt, ...ordinaryPrimary } = ordinary.report;
  assert.equal(typeof tracedAt, 'string'); assert.equal(typeof ordinaryAt, 'string');
  assert.deepEqual(tracedPrimary, ordinaryPrimary, 'the actual report preserves all default primary fields and quality aggregates');
  assert.equal(taskSpanReplay.currentSearchEvidence, false); assert.equal(taskSpanReplay.summary.metrics.deliveredCoverage.repositoryMacro, 0.25);
  const stale = makeTaskSpanTrace(); stale.identity.queryDigest = '0'.repeat(64);
  const refused = await execute([{ ...entry, taskTrace: stale }], 'refused');
  assert.equal(refused.report.taskSpanReplay.complete, false);
  assert.deepEqual(refused.report.summary, ordinary.report.summary, 'trace refusal retains live judged metrics');
  assert.deepEqual(refused.calls, ordinary.calls);
  const trace = makeTaskSpanTrace();
  const interventionEvidence = { schemaVersion: 1, queryDigest: hash(query), trials: [{ id: hash('origin-trial'), profile: 'origin-observation-v1',
    input: { schemaVersion: 1, trace, origins: [{ id: hash('origin'), dependenceGroupId: null, independence: 'unknown', assumptionIds: [] }],
      sourceBindings: trace.sources.map(source => ({ sourceKey: source.key, originIds: [hash('origin')], lineage: 'authored-origin', lineageReceiptId: hash(source.key) })), edges: [] } }] };
  const intervened = await execute([{ ...entry, interventionEvidence }], 'intervention');
  const { interventionEvaluation, generatedAt: interventionAt, ...interventionPrimary } = intervened.report;
  assert.equal(typeof interventionAt, 'string'); assert.deepEqual(interventionPrimary, ordinaryPrimary);
  assert.deepEqual(intervened.calls, ordinary.calls, 'offline model/lineage/attack records cannot alter actual provider requests');
  assert.equal(interventionEvaluation.currentSearchEvidence, false); assert.equal(interventionEvaluation.summary.evaluatedTrials, 1);
  const invalidIntervention = await execute([{ ...entry, interventionEvidence: { ...interventionEvidence, queryDigest: '0'.repeat(64) } }], 'refused-intervention');
  assert.equal(invalidIntervention.report.interventionEvaluation.complete, false);
  assert.equal(invalidIntervention.report.interventionEvaluation.summary.refusedInputs, 1);
  assert.deepEqual(invalidIntervention.calls, ordinary.calls); assert.deepEqual(invalidIntervention.report.summary, ordinary.report.summary);
  for (const failure of [false, 0, null, new Error('original offline rejection')]) {
    try { await execute([entry], 'offline-error-' + String(failure), { offlineFailure: failure }); assert.fail('Expected original offline rejection'); }
    catch (error) { assert.equal(error, failure, 'the actual replay rejection survives already-completed cleanup'); }
  }
} finally {
  hooks.deregister(); console.log = log; delete globalThis.taskSpanRunnerFixture;
}
console.log('Actual eval report default/opt-in/refused trace parity and search isolation assertions complete');
