import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { startMcpSdkServer } from '../../../tools/mcp/server-sdk.js';
import { classifyMcpToolLane, resolveMcpLaneAdmission } from '../../../tools/mcp/lane-policy.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const waitFor = async predicate => {
  const deadline = performance.now() + 3000;
  while (!predicate()) { if (performance.now() >= deadline) throw new Error('SDK lane fixture did not reach its expected state.'); await tick(); }
};
const errorCode = response => response.isError ? JSON.parse(response.content[0].text).code : null;
const setup = async (queueMax, executeTool) => {
  const [clientTransport, transport] = InMemoryTransport.createLinkedPair();
  const service = await startMcpSdkServer({ transport, queueMax,
    serverInfo: { name: 'sdk-diagnostic-lane', version: '1' },
    toolDefs: ['fixture', 'index_status', 'config_status'].map(name => ({ name, description: 'Controlled SDK lane fixture', inputSchema: { type: 'object' } })),
    resolveToolTimeoutMs: () => 30000, executeTool });
  const client = new Client({ name: 'sdk-diagnostic-lane-client', version: '1' }); await client.connect(clientTransport);
  const calls = [];
  const call = (name, mode = name, signal) => {
    const result = client.callTool({ name, arguments: { mode } }, undefined, signal ? { signal } : {});
    result.catch(() => {}); calls.push(result); return result;
  };
  return { service, call, async close() { await service.close(); await client.close(); await Promise.allSettled(calls); } };
};

assert.equal(classifyMcpToolLane('index_status', 30000), 'fast');
assert.equal(classifyMcpToolLane('config_status', 30000), 'fast');
assert.equal(classifyMcpToolLane('build_index', 1), 'slow', 'SDK timeout cannot promote a mutating operation');
assert.equal(classifyMcpToolLane('fixture', 1000, { allowShortTimeoutFast: true }), 'fast', 'legacy short-timeout compatibility remains explicit');
assert.deepEqual(resolveMcpLaneAdmission({ lane: 'slow', queueMax: 3, occupancy: { fast: 0, slow: 2 } }), { overloaded: true, reason: 'fast-lane-reserved-capacity' });

{
  const release = deferred(), teardown = deferred(), firstStarted = deferred(), starts = [];
  const abort = new AbortController();
  const test = await setup(3, async (name, { mode }, { signal }) => {
    starts.push(mode);
    if (mode === 'held') {
      firstStarted.resolve();
      await new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true }); });
      teardown.resolve(); await release.promise; signal.throwIfAborted();
    }
    return { tool: name, mode };
  });
  try {
    const first = test.call('fixture', 'held', abort.signal); await firstStarted.promise;
    const second = test.call('fixture', 'next');
    await waitFor(() => test.service.getQueueState().lanes.slow.queued === 1);
    assert.equal(errorCode(await test.call('fixture', 'excess')), 'QUEUE_OVERLOADED');
    for (const name of ['index_status', 'config_status']) assert.equal(errorCode(await test.call(name)), null);
    assert.ok(!starts.includes('next'), 'diagnostics complete before the held slow tool');
    abort.abort(); await assert.rejects(first); await teardown.promise;
    assert.equal(test.service.queue.pending, 1); assert.equal(test.service.getQueueState().lanes.slow.active, 1);
    for (let index = 0; index < 40; index++) assert.equal(errorCode(await test.call('index_status', `status-${index}`)), null);
    assert.ok(!starts.includes('next'), 'running cancellation retains slow capacity through original teardown');
    const snapshot = test.service.getQueueState();
    assert.equal(snapshot.lanes.slow.queued, 1); assert.equal(snapshot.rejectionReasons['fast-lane-reserved-capacity'], 1);
    assert.equal(snapshot.recentSettlements.length, 32); assert.equal(snapshot.lanes.fast.settled, 42);
    assert.ok(snapshot.recentSettlements.every(row => row.lane === 'fast' && row.queueWaitMs >= 0 && row.ownedExecutionAndCleanupMs >= 0));
    snapshot.lanes.slow.active = 99; assert.equal(test.service.getQueueState().lanes.slow.active, 1, 'diagnostic snapshots cannot mutate admission');
    release.resolve(); assert.equal(errorCode(await second), null); assert.ok(starts.includes('next')); assert.ok(!starts.includes('excess'));
    await test.service.queue.onIdle(); assert.equal(test.service.getQueueState().lanes.slow.active, 0);
  } finally { abort.abort(); release.resolve(); await test.close(); }
}

{
  const release = deferred(), entered = deferred(), starts = [], queuedAbort = new AbortController();
  const test = await setup(3, async (name, { mode }) => {
    starts.push(mode); if (mode === 'held-status') { entered.resolve(); await release.promise; }
    return { tool: name, mode };
  });
  try {
    const held = test.call('index_status', 'held-status'); await entered.promise;
    const queued = test.call('config_status', 'never-status', queuedAbort.signal);
    await waitFor(() => test.service.getQueueState().lanes.fast.queued === 1);
    assert.equal(errorCode(await test.call('index_status', 'excess-status')), 'QUEUE_OVERLOADED');
    assert.equal(test.service.getQueueState().rejectionReasons['slow-lane-reserved-capacity'], 1);
    assert.equal(errorCode(await test.call('fixture', 'slow-still-admitted')), null, 'diagnostic pressure preserves slow admission');
    assert.ok(starts.includes('slow-still-admitted')); assert.ok(!starts.includes('never-status'));
    queuedAbort.abort(); await assert.rejects(queued);
    assert.equal(test.service.getQueueState().lanes.fast.queued, 1, 'PQueue still owns the aborted admission until its turn; do not fabricate early release');
    release.resolve(); assert.equal(errorCode(await held), null);
    await waitFor(() => test.service.getQueueState().lanes.fast.cancelledBeforeStart === 1);
    assert.equal(errorCode(await test.call('config_status', 'next-status')), null);
    assert.ok(!starts.includes('never-status')); assert.ok(!starts.includes('excess-status'));
  } finally { queuedAbort.abort(); release.resolve(); await test.close(); }
}

{
  const release = deferred(), entered = deferred();
  const test = await setup(1, async (_name, { mode }) => { if (mode === 'held-one') { entered.resolve(); await release.promise; } return { mode }; });
  try {
    const held = test.call('fixture', 'held-one'); await entered.promise;
    assert.equal(test.service.queues.fast, test.service.queues.slow);
    assert.equal(errorCode(await test.call('index_status')), 'QUEUE_OVERLOADED', 'capacity one cannot invent a second lease');
    release.resolve(); await held; assert.equal(errorCode(await test.call('config_status')), null);
  } finally { release.resolve(); await test.close(); }
}

{
  const releases = { slow: deferred(), fast: deferred() }, entered = { slow: deferred(), fast: deferred() };
  const test = await setup(3, async (name, _args, { signal }) => {
    const lane = name === 'fixture' ? 'slow' : 'fast'; entered[lane].resolve();
    await releases[lane].promise; signal.throwIfAborted();
  });
  try {
    test.call('fixture'); test.call('index_status'); await Promise.all(Object.values(entered).map(value => value.promise));
    let settled = false; const closing = test.service.close(); closing.finally(() => { settled = true; }).catch(() => {});
    await tick(); assert.equal(settled, false);
    releases.slow.resolve(); await tick(); assert.equal(settled, false, 'shutdown still owns fast-lane teardown');
    releases.fast.resolve(); await closing; assert.equal(settled, true);
    const snapshot = test.service.getQueueState(); assert.equal(snapshot.lanes.fast.active + snapshot.lanes.slow.active, 0);
  } finally { releases.fast.resolve(); releases.slow.resolve(); await test.close(); }
}
console.log('Actual SDK status tools retain bounded independent admission, original cleanup leases, reciprocal headroom and single-capacity behavior.');
