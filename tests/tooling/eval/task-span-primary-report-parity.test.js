import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { makeTaskSpanTrace, TASK_TRACE_FIXTURE_QUERY as query } from '../../helpers/task-span-trace-fixture.js';

// Execute the actual existing report entry with inert search/filesystem/display
// boundaries. Optional trace labels must never reach a search request.
const runner = new URL('../../../tools/eval/run.js', import.meta.url).href;
const stubs = {
  '../shared/operator-cli-options.js': 'export const EVAL_OPTIONS = {};',
  'node:fs': 'export default {readFileSync(){return JSON.stringify(globalThis.taskSpanRunnerFixture.dataset);}};',
  '../../src/shared/cli.js': 'export const createCli = () => ({parse:()=>globalThis.taskSpanRunnerFixture.argv});',
  '../shared/cli-display.js': 'export const createToolDisplay = () => ({task(){return {set(){}};},close(){},error(message){throw new Error(message);}});',
  '../../src/integrations/core/index.js': `export const search = async (root, options) => {
    globalThis.taskSpanRunnerFixture.calls.push({root,query:options.query,args:[...options.args]});
    return {code:[{file:'first/shared.ts',name:'fixture',score:1}]};
  };`,
  '../../src/retrieval/sqlite-cache.js': 'export const createSqliteDbCache = () => ({});'
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.split('?')[0] === runner && Object.hasOwn(stubs, specifier)) return {
      url: `task-span-fixture:${encodeURIComponent(specifier)}`, shortCircuit: true
    };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('task-span-fixture:')) return { format: 'module', source: stubs[decodeURIComponent(url.slice('task-span-fixture:'.length))], shortCircuit: true };
    return next(url, context);
  }
});
const log = console.log;
try {
  const execute = async (dataset, id) => {
    const fixture = { dataset, calls: [], argv: { dataset: 'inert-task-trace.json', top: 10, backend: 'memory' }, lines: [] };
    globalThis.taskSpanRunnerFixture = fixture;
    console.log = value => fixture.lines.push(value);
    await import(`${runner}?task-span-fixture=${id}`);
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
} finally {
  hooks.deregister(); console.log = log; delete globalThis.taskSpanRunnerFixture;
}
console.log('Actual eval report default/opt-in/refused trace parity and search isolation assertions complete');
