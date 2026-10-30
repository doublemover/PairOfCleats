import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { projectOwnedProcessTree, readWindowsProcessSnapshot } from '../../../tools/bench/language/process-tree-snapshot.js';
import { createBenchProcessTreeSampler } from '../../../tools/bench/language/process-tree-memory.js';
import { executeBenchQueryPlan } from './query-execution.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('perf/bench/process-tree-memory/')[1];
assert.ok(['descendants', 'pid-reuse', 'orphan', 'partial', 'malformed', 'lifecycle', 'bounds', 'overlap',
  'unavailable', 'unsettled-observer', 'unsupported', 'reader', 'failure-drain'].includes(mode));
const row = (pid, parentPid, createdAtTicks, rssBytes) => ({ pid, parentPid,
  createdAtTicks: createdAtTicks === null ? null : String(createdAtTicks), rssBytes });
const root = row(100, 1, '638970000000000001', 100);
const child = row(200, 100, '638970000000000002', 200);
const grandchild = row(300, 200, '638970000000000003', 300);
const snapshot = rows => ({ version: 1, observerPid: 900, rows });
const project = (rows, extra = {}) => projectOwnedProcessTree({ snapshot: snapshot(rows), rootPid: 100, ...extra });

if (mode === 'descendants') {
  const result = project([root, child, grandchild, row(400, 999, '638970000000000004', 400),
    row(900, 100, '638970000000000005', 100000), row(901, 900, '638970000000000006', 100000)]);
  assert.deepEqual(result.processes.map(value => value.pid), [100, 200, 300]);
  assert.equal(result.rssBytes, 600); assert.equal(result.status, 'complete-snapshot');
  assert.equal(result.excludedObserverProcesses, 2);
  assert.equal(result.rootCreatedAtTicks, root.createdAtTicks, 'creation identity must retain sub-millisecond precision');
} else if (mode === 'pid-reuse') {
  const result = project([root, child, row(250, 100, '638970000000000000', 10000),
    row(260, 200, '638970000000000001', 10000)]);
  assert.equal(result.rssBytes, 300); assert.equal(result.excludedReusedParentLinks, 2);
  assert.throws(() => project([root], { rootCreatedAtTicks: '638970000000000000' }), /root PID was reused/);
} else if (mode === 'orphan') {
  const first = project([root, child, grandchild]);
  const knownIdentities = new Set(first.identities);
  const later = [root, grandchild, row(350, 300, '638970000000000004', 350)];
  assert.deepEqual(project(later).processes.map(value => value.pid), [100], 'a new observer cannot borrow an orphan by PID alone');
  const retained = project(later, { knownIdentities });
  assert.deepEqual(retained.processes.map(value => value.pid), [100, 300, 350]);
  assert.equal(retained.rssBytes, 750);
  const ambiguous = project([...later, row(400, 200, '638970000000000005', 400)], { knownIdentities });
  assert.equal(ambiguous.unresolvedParentLinks, 1); assert.equal(ambiguous.status, 'partial-snapshot');
  assert.equal(ambiguous.rssBytes, null); assert.equal(ambiguous.observedOwnedRssBytes, 750);
} else if (mode === 'partial') {
  for (const value of [row(200, 100, null, 200), row(200, 100, child.createdAtTicks, null)]) {
    const result = project([root, value]);
    assert.equal(result.rssBytes, null); assert.equal(result.status, 'partial-snapshot');
    assert.ok(result.ambiguousIdentities || result.missingRss);
  }
} else if (mode === 'malformed') {
  for (const rows of [[root, root], [root, { ...child, rssBytes: -1 }], [root, { ...child, rssBytes: 1.5 }],
    [root, { ...child, createdAtTicks: '1e12' }], [root, { ...child, createdAtTicks: 638970000000000000 }]]) {
    assert.throws(() => project(rows), { code: 'ERR_BENCH_PROCESS_TREE_SNAPSHOT' });
  }
  assert.throws(() => project([root, child], { maxProcesses: 1 }), /observation budget/);
  assert.throws(() => projectOwnedProcessTree({ snapshot: { ...snapshot([root]), observerPid: 100 }, rootPid: 100 }), /observer cannot own/);
} else if (mode === 'reader') {
  let calls = 0;
  const run = async (command, args, options) => {
    calls++; assert.match(command, /WindowsPowerShell.*powershell\.exe$/iu);
    assert.ok(args.includes('-NoProfile')); assert.ok(args.includes('-NonInteractive'));
    assert.ok(args.at(-1).includes('Get-CimInstance')); assert.ok(!args.at(-1).includes('CommandLine'));
    assert.equal(options.timeoutMs, 3000); assert.equal(options.cleanupOnParentExit, true);
    return { pid: 900, exitCode: 0, stdout: JSON.stringify(snapshot([root, child])) };
  };
  assert.equal((await readWindowsProcessSnapshot({ platform: 'win32', run })).rows.length, 2);
  assert.equal(calls, 1);
  for (const result of [{ pid: 900, stdout: '{' }, { pid: 901, stdout: JSON.stringify(snapshot([root])) },
    { pid: 900, stdout: '{}', outputCapture: { stdout: { truncated: true } } },
    { pid: 900, stdout: '{}', outputCapture: { stdout: { encodingLoss: true } } },
    { pid: 900, stdout: JSON.stringify(snapshot([root])), exitCode: 1 },
    { pid: 900, stdout: JSON.stringify(snapshot([root])), stderr: 'unexpected warning' }]) {
    await assert.rejects(readWindowsProcessSnapshot({ platform: 'win32', run: async () => ({ exitCode: 0, ...result }) }),
      { code: 'ERR_BENCH_PROCESS_TREE_SNAPSHOT' });
  }
} else if (mode === 'failure-drain') {
  const bothStarted = Promise.withResolvers(), releaseSecond = Promise.withResolvers(), firstFailed = Promise.withResolvers();
  const primary = Object.assign(new Error('query failed'), { code: 'ERR_FIXTURE_QUERY' });
  const secondary = Object.assign(new Error('pool close failed'), { code: 'ERR_FIXTURE_POOL_CLOSE' });
  const started = [], boundaries = [];
  let publicSettled = false, secondSettled = false;
  const work = executeBenchQueryPlan({ plan: { status: 'admitted', stages: [{ effectiveConcurrency: 2, sizeByBackend: { memory: 2 } }],
    backendMaxRunsPerWorker: {} }, tasks: ['a', 'b', 'c'].map(id => ({ id, backend: 'memory' })),
  createPool: () => ({ async close() { assert.equal(secondSettled, true); boundaries.push('pool-close'); throw secondary; } }),
  processTreeSampler: { beginPhase: async () => boundaries.push('begin'), endPhase: async () => boundaries.push('end'),
    observeEvent() {}, finish: async () => { boundaries.push('finish'); return { status: 'unavailable', sampledPeakBytes: null }; } },
  async runTask(task) {
    started.push(task.id); if (started.length === 2) bothStarted.resolve();
    await bothStarted.promise;
    if (task.id === 'a') { firstFailed.resolve(); throw primary; }
    await releaseSecond.promise; secondSettled = true;
  }
  });
  void work.then(() => { publicSettled = true; }, () => { publicSettled = true; });
  await firstFailed.promise; await nextTurn();
  assert.equal(publicSettled, false); assert.deepEqual(started, ['a', 'b']);
  assert.deepEqual(boundaries, ['begin']);
  releaseSecond.resolve();
  await assert.rejects(work, error => {
    const pending = [error], seen = new Set();
    while (pending.length) { const value = pending.pop(); if (!value || seen.has(value)) continue; seen.add(value);
      pending.push(value.cause, ...(value.errors || [])); }
    assert.ok(seen.has(primary)); assert.ok(seen.has(secondary));
    assert.equal(error.benchmarkQueryObservation.completed, 1);
    assert.equal(error.benchmarkQueryObservation.failed, 1);
    return true;
  });
  assert.deepEqual(boundaries, ['begin', 'pool-close', 'end', 'finish']);
  assert.deepEqual(started, ['a', 'b']);
} else {
  let clock = 0, calls = 0;
  const full = snapshot([root, child, grandchild]);
  const initial = snapshot([root]);
  let loader = async () => { calls++; clock += 5; return calls === 2 ? full : initial; };
  if (mode === 'unavailable') loader = async () => { calls++; throw Object.assign(new Error('CIM unavailable'), { code: 'EPERM' }); };
  if (mode === 'unsettled-observer') loader = async () => { calls++; throw Object.assign(new Error('observer close remains pending'),
    { cacheOwnershipPending: true, cacheOwnershipReleased: () => false }); };
  const options = { platform: mode === 'unsupported' ? 'other' : 'win32', rootPid: 100, automatic: false,
    now: () => clock, snapshot: () => loader() };
  if (mode === 'bounds') Object.assign(options, { maxSamples: 1, maxEvents: 1 });
  const owner = createBenchProcessTreeSampler(options);
  if (mode === 'unsettled-observer') {
    await assert.rejects(owner.beginPhase('query'), error => error.cacheOwnershipPending === true);
    await assert.rejects(owner.finish(), error => error.cacheOwnershipPending === true);
    assert.equal(calls, 1, 'an unsettled observer must not trigger another observer');
  } else if (mode === 'overlap') {
    const entered = Promise.withResolvers(), release = Promise.withResolvers();
    loader = async () => { calls++; if (calls === 1) { entered.resolve(); return release.promise; } return initial; };
    const beginning = owner.beginPhase('query'); await entered.promise;
    const additional = owner.sample('overlap'); assert.equal(calls, 1);
    release.resolve(full); await Promise.all([beginning, additional]);
    await owner.finish(); assert.equal(calls, 2);
  } else {
    await owner.beginPhase('query');
    owner.observeEvent({ type: 'process-start', pid: 200 });
    if (mode === 'lifecycle') {
      clock += 20; await owner.sample('during-query');
      owner.observeEvent({ type: 'process-start', pid: 700 });
      owner.observeEvent({ type: 'process-close', pid: 700 });
    } else if (mode === 'bounds') owner.observeEvent({ type: 'process-start', pid: 701 });
    owner.observeEvent({ type: 'process-close', pid: 200 });
    clock += 50;
    const report = await owner.finish();
    assert.equal(report.peakIsLowerBound, true); assert.equal(report.atomicSnapshot, false);
    assert.ok(report.maxSamplingGapMs >= 50);
    if (mode === 'lifecycle') {
      assert.equal(report.sampledPeakBytes, 600); assert.equal(report.sampleCount, 3);
      assert.equal(report.missedWorkerLifetimes, 1); assert.equal(report.status, 'sampled-with-gaps');
      assert.equal(report.lifetimes.find(value => value.pid === 300).missingAtMs !== null, true);
    } else if (mode === 'bounds') {
      assert.equal(report.samplesCapped, true); assert.equal(report.eventsCapped, true);
      assert.equal(report.sampleCount, 1); assert.equal(report.missedWorkerLifetimes, 1);
    } else if (mode === 'unavailable') {
      assert.equal(report.sampledPeakBytes, null); assert.equal(report.status, 'unavailable');
      assert.ok(report.samples.every(value => value.errorCode === 'EPERM' && value.rssBytes === null));
    } else {
      assert.equal(report.status, 'unsupported-platform'); assert.equal(report.sampledPeakBytes, null); assert.equal(calls, 0);
    }
    assert.deepEqual(await owner.finish(), report, 'finishing an observation owner is idempotent');
  }
}
console.log(`Bounded process-tree observation and query lifetime: ${mode}`);
