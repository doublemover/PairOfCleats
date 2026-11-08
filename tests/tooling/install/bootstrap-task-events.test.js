import assert from 'node:assert/strict';
import { runBootstrapTasks, BOOTSTRAP_TASK_EVENT_VERSION } from '../../../tools/setup/bootstrap-tasks.js';
import { formatBootstrapTaskProgress } from '../../../tools/setup/task-progress.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/bootstrap-task-events/')[1];
assert.ok(['ordered-admission-and-timing', 'immediate-failure-and-drain', 'original-observer-failures', 'bounded-diagnostics',
  'output-observer-settlement', 'output-observer-errors', 'output-observer-limits', 'output-original-resource-retirement'].includes(mode));
const budget = { jobs: 2, cpuCount: 2, memoryBytes: 1024 }, events = [];
const context = { runId: 'original-root-run', planId: 'original-plan' };
if (mode === 'ordered-admission-and-timing') {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const pending = runBootstrapTasks([
    { id: 'first', run: async () => { entered.resolve(); await release.promise; return 'one'; } },
    { id: 'second', run: async () => 'two' },
    { id: 'dependent', dependsOn: ['first'], run: async () => 'three' }
  ], { budget: { jobs: 1, cpuCount: 1, memoryBytes: 1024 }, eventContext: context, onEvent: event => events.push(event) });
  await entered.promise;
  try {
    while (!events.some(event => event.taskId === 'second' && event.state === 'resource-wait')) await new Promise(resolve => setImmediate(resolve));
    assert.equal(events.some(event => event.taskId === 'second' && event.state === 'started'), false);
    assert.equal(events.some(event => event.taskId === 'dependent' && event.state === 'dependency-wait'), true);
  } finally { release.resolve(); }
  const result = await pending;
  assert.equal(result.ok, true);
  assert.deepEqual(events.map(event => event.sequence), events.map((_, index) => index + 1));
  assert.equal(new Set(events.map(event => event.batchId)).size, 1);
  for (const id of ['first', 'second', 'dependent']) {
    const selected = events.filter(event => event.taskId === id);
    const states = selected.map(event => event.state);
    assert.ok(states.indexOf('queued') < states.indexOf('resource-wait'));
    assert.ok(states.indexOf('resource-wait') < states.indexOf('started'));
    assert.equal(states.at(-1), 'succeeded');
    assert.ok(selected.every(event => event.schemaVersion === BOOTSTRAP_TASK_EVENT_VERSION && Object.isFrozen(event)
      && event.runId === context.runId && event.planId === context.planId && event.attempt === 1));
    const row = result.results.find(row => row.id === id);
    assert.ok(row.admissionAt >= row.queuedAt); assert.ok(row.startedAt >= row.admissionAt);
    assert.equal(row.admissionWaitMs, row.startedAt - row.admissionAt);
    assert.equal(row.durationMs, row.finishedAt - row.startedAt); assert.ok(row.dependencyWaitMs >= 0);
  }
  const next = [];
  await runBootstrapTasks([{ id: 'first', run: async () => 'new invocation' }], { budget, eventContext: context, onEvent: event => next.push(event) });
  assert.notEqual(next[0].batchId, events[0].batchId, 'repeated graphs within one root run retain distinct execution identities');
} else if (mode === 'immediate-failure-and-drain') {
  const entered = Promise.withResolvers(), release = Promise.withResolvers(), observed = Promise.withResolvers();
  const original = new Error('actual compiler failed'); let returned = false, peerRetired = false;
  const pending = runBootstrapTasks([
    { id: 'peer', run: async ({ signal }) => {
      entered.resolve(); if (!signal.aborted) await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      await release.promise; peerRetired = true;
    } },
    { id: 'compiler', run: async () => { await entered.promise; throw original; } },
    { id: 'dependent', dependsOn: ['compiler'], run: () => assert.fail('blocked dependent ran') }
  ], { budget, onEvent: event => {
    events.push(event); if (event.taskId === 'compiler' && event.state === 'failed') observed.resolve(event);
  } });
  pending.then(() => { returned = true; });
  const failureEvent = await observed.promise;
  assert.equal(returned, false); assert.equal(peerRetired, false); assert.equal(failureEvent.error.message, original.message);
  assert.equal(failureEvent.taskResourceState, 'retired'); release.resolve();
  const result = await pending; assert.equal(result.ok, false); assert.equal(peerRetired, true);
  assert.equal(events.filter(event => event.taskId === 'dependent' && event.state === 'blocked').length, 1);
  const optionalEvents = [];
  const optional = await runBootstrapTasks([
    { id: 'optional', required: false, run: async () => ({ ok: false, message: 'optional unavailable' }) },
    { id: 'required', dependsOn: [{ id: 'optional', settled: true }], run: async () => 'usable' }
  ], { budget, onEvent: event => optionalEvents.push(event) });
  assert.equal(optional.ok, true); assert.equal(optionalEvents.find(event => event.state === 'failed').required, false);
} else if (mode === 'original-observer-failures') {
  for (const original of [false, 0, '', null, undefined, Object.freeze(new Error('renderer EPIPE'))]) {
    let ran = false, rejected = false; const rows = [];
    try { await runBootstrapTasks([{ id: 'compiler', run: async () => { ran = true; } }], { budget,
      onEvent: async event => { if (event.state === 'started') throw original; }, onResult: row => rows.push(row) }); }
    catch (error) { rejected = true; assert.equal(error, original); }
    assert.equal(rejected, true); assert.equal(ran, false); assert.equal(rows[0].status, 'cancelled');
  }
  const operation = Object.freeze(new Error('compiler error')), logging = Object.freeze(new Error('independent terminal renderer failure'));
  const combined = await runBootstrapTasks([{ id: 'compiler', run: async () => { throw operation; } }], { budget,
    onEvent: event => { if (event.state === 'failed') throw logging; } }).catch(error => error);
  assert.equal(errorGraphIncludes(combined, operation), true); assert.equal(errorGraphIncludes(combined, logging), true);
  const entered = Promise.withResolvers(), release = Promise.withResolvers(); let ran = false;
  const pending = runBootstrapTasks([{ id: 'compiler', run: async () => { ran = true; } }], { budget,
    onEvent: async event => { if (event.state === 'queued') { entered.resolve(); await release.promise; } } });
  await entered.promise; assert.equal(ran, false); release.resolve(); assert.equal((await pending).ok, true);
} else if (mode === 'output-observer-settlement') {
  const entered = Promise.withResolvers(), release = Promise.withResolvers(); let returned = false, observed = false, reporter;
  const pending = runBootstrapTasks([{ id: 'compiler', run: async ({ observeOutput }) => {
    reporter = observeOutput;
    observeOutput({ channel: 'stdout', attempt: 3, path: 'owned-log.stdout', observedBytes: 8 });
    return 'actual compiler result';
  } }], { budget, onEvent: async event => {
    events.push(event);
    if (event.state === 'output-observed') {
      assert.deepEqual(event.output, { channel: 'stdout', attempt: 3, path: 'owned-log.stdout', observedBytes: 8 });
      assert.equal(Object.isFrozen(event.output), true); entered.resolve(); await release.promise; observed = true;
    }
  }, onResult: () => { assert.equal(observed, true); } });
  pending.then(() => { returned = true; });
  await entered.promise; assert.equal(returned, false); release.resolve();
  const result = await pending; assert.equal(result.ok, true); assert.equal(result.results[0].result, 'actual compiler result');
  assert.throws(() => reporter({ channel: 'stdout', attempt: 3, path: 'owned-log.stdout', observedBytes: 9 }), /outlived/);
} else if (mode === 'output-observer-errors') {
  for (const original of [false, 0, '', null, undefined, Object.freeze(new Error('actual output observer failed'))]) {
    const compiler = Object.freeze(new Error('independent compiler failure'));
    const failure = await runBootstrapTasks([{ id: 'compiler', run: async ({ observeOutput }) => {
      observeOutput({ channel: 'stderr', attempt: 1, path: 'owned-log.stderr', observedBytes: 4 }); throw compiler;
    } }], { budget, onEvent: async event => { if (event.state === 'output-observed') throw original; } }).catch(error => error);
    assert.equal(errorGraphIncludes(failure, original), true); assert.equal(errorGraphIncludes(failure, compiler), true);
  }
} else if (mode === 'output-original-resource-retirement') {
  let retired = false, returned = false, row;
  const observed = Promise.withResolvers();
  const original = Object.assign(new Error('output observer rejected with original physical work outstanding'), {
    cacheOwnershipPending: true, cacheOwnershipReleased: () => retired
  });
  const pending = runBootstrapTasks([{ id: 'compiler', run: async ({ observeOutput }) => {
    observeOutput({ channel: 'stdout', attempt: 1, path: 'owned-log.stdout', observedBytes: 3 }); return 'compiled';
  } }], { budget, onEvent: event => { if (event.state === 'output-observed') throw original; },
    onResult: actual => { row = actual; observed.resolve(); } });
  const outcome = pending.then(() => { returned = true; assert.fail('Pending output observation cannot publish success'); }, error => { returned = true; return error; });
  await observed.promise;
  try {
    original.cacheOwnershipReleased = () => true;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(returned, false, 'the original task reservation still participates in scheduler drain');
    assert.equal(row.status, 'failed'); assert.equal(row.error.cacheOwnershipReleased(), false);
  } finally { retired = true; }
  const failure = await outcome; assert.equal(errorGraphIncludes(failure, original), true);
} else if (mode === 'output-observer-limits') {
  let observations = 0;
  const failure = await runBootstrapTasks([{ id: 'compiler', run: async ({ observeOutput }) => {
    for (let index = 0; index < 65; index++) observeOutput({ channel: 'stdout', attempt: index + 1, path: 'owned-log.stdout', observedBytes: 1 });
  } }], { budget, onEvent: event => { if (event.state === 'output-observed') observations++; } }).catch(error => error);
  assert.ok(failure instanceof Error); assert.equal(observations, 64);
  let getterReads = 0;
  const invalid = Object.defineProperty({}, 'channel', { get() { getterReads++; return 'stdout'; } });
  await assert.rejects(runBootstrapTasks([{ id: 'compiler', run: async ({ observeOutput }) => observeOutput(invalid) }],
    { budget, onEvent: () => {} }));
  assert.equal(getterReads, 0, 'producer metadata accessors cannot become output evidence');
} else {
  let reads = 0;
  const original = Object.freeze(Object.defineProperties({}, {
    message: { get() { reads++; throw new Error('diagnostic getter ran'); } },
    code: { get() { reads++; throw new Error('diagnostic getter ran'); } }
  }));
  const result = await runBootstrapTasks([{ id: 'compiler', run: async () => { throw original; } }], { budget, onEvent: event => events.push(event) });
  assert.equal(result.results[0].error, original); assert.equal(reads, 0);
  assert.deepEqual(events.at(-1).error, { code: null, message: null }); assert.equal(Object.isFrozen(events.at(-1).error), true);
  assert.equal(formatBootstrapTaskProgress({ state: 'queued' }, 'native'), null);
  const line = formatBootstrapTaskProgress({ state: 'failed', taskId: 'bad\u001b[31m\npackage', required: false,
    taskResourceState: 'pending', error: { message: '\u001b]0;injected\u0007failure\r\n' + 'x'.repeat(1000) } }, 'native');
  assert.doesNotMatch(line, /[\u0000-\u001f\u007f-\u009f]/); assert.ok(line.length < 400);
  assert.match(line, /optional/); assert.match(line, /retirement pending/);
  await assert.rejects(runBootstrapTasks(Array.from({ length: 257 }, (_, index) => ({ id: String(index), run() {} })), { budget }), /finite task plan/);
  await assert.rejects(runBootstrapTasks([], { budget, eventContext: { runId: '../ambient-path' } }), /bounded run/);
}
console.log('Bootstrap task events reflect original admission, results, timing and observer settlement');
