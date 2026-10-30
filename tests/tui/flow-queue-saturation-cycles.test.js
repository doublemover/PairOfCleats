import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createFlowController } from '../../tools/tui/supervisor/protocol-flow.js';
import { FLOW_DEFAULT_CREDITS, FLOW_QUEUE_MAX, FLOW_CHUNK_CHARS } from '../../tools/tui/supervisor/constants.js';

const cases = ['all-log', 'no-log', 'mixed', 'coalesced', 'chunks', 'work'];
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('tui/flow-queue-saturation-cycles/')[1];
assert.ok(cases.includes(selected));
const capacity = FLOW_QUEUE_MAX, cycles = 5;

const exercise = kind => {
  const received = [];
  let sequence = 0, admissions = 0, peakQueue = 0, wireBytes = 0;
  const flow = createFlowController({ runId: `cycles-${kind}`, nextSeq: () => ++sequence,
    output: { write(text) { wireBytes += Buffer.byteLength(text); received.push(JSON.parse(text)); return true; } } });
  const emit = (event, taskId, extra = {}, jobId = 'still-running') => {
    flow.emit(event, { ...(taskId == null ? {} : { taskId }), ...extra }, { jobId });
    admissions++;
    const snapshot = flow.buildFlowSnapshot();
    peakQueue = Math.max(peakQueue, snapshot.queueDepth);
    assert.ok(snapshot.queueDepth <= capacity, `${kind}: every admission, including a rejected event, stays bounded`);
  };
  for (let n = 0; n < FLOW_DEFAULT_CREDITS; n++) emit('task:progress', `warm-${n}`);
  assert.equal(flow.buildFlowSnapshot().credits, 0);
  const start = received.length;
  let dropped = 0, coalesced = 0, lifecycleDropped = 0, chunkFrames = 0;
  if (kind === 'all-log') {
    for (let n = 0; n < capacity; n++) emit('log', null, { message: `initial-${n}` });
    for (let cycle = 0; cycle < cycles; cycle++) {
      for (let n = 0; n <= capacity; n++) emit('log', null, { message: `${cycle}-${n}` });
      dropped += capacity + 1;
      assert.equal(flow.buildFlowSnapshot().dropped, dropped);
    }
  } else if (kind === 'no-log') {
    // The exact original finite witness: a log against a full progress-only
    // queue, then five attempts to replace its contents with task starts.
    for (let n = 0; n < capacity; n++) emit('task:progress', `initial-${n}`);
    emit('log', null, { message: 'original-overflow' }); dropped++;
    for (let cycle = 0; cycle < cycles; cycle++) {
      for (let n = 0; n < capacity; n++) emit('task:start', `cycle-${cycle}-${n}`);
      emit('log', null, { message: `overflow-${cycle}` });
      dropped += capacity + 1;
      if (cycle > 0) lifecycleDropped += capacity;
      assert.equal(flow.buildFlowSnapshot().dropped, dropped);
      assert.equal(flow.buildFlowSnapshot().lifecycleDropped, lifecycleDropped);
    }
  } else if (kind === 'mixed') {
    for (let n = 0; n < capacity; n++) emit(n % 2 ? 'task:progress' : 'log', `initial-${n}`, { message: String(n) });
    for (let cycle = 0; cycle < cycles; cycle++) {
      for (let n = 0; n < 100; n++) {
        emit('log', null, { message: `${cycle}-${n}` });
        emit('task:progress', `new-${cycle}-${n}`);
      }
      dropped += 200;
      assert.equal(flow.buildFlowSnapshot().dropped, dropped);
    }
  } else if (kind === 'coalesced') {
    for (let n = 0; n < capacity; n++) emit('task:progress', `same-${n}`);
    for (let cycle = 0; cycle < cycles; cycle++) {
      for (let n = 0; n < capacity; n++) emit('task:progress', `same-${n}`, { current: cycle });
      coalesced += capacity;
      assert.equal(flow.buildFlowSnapshot().coalesced, coalesced);
    }
    emit('task:end', 'same-0', { status: 'failed' }); coalesced++;
    emit('task:progress', 'same-0', { status: 'running' }); dropped++;
    emit('task:start', 'same-0'); dropped++;
    emit('task:progress', 'same-0'); dropped++;
    emit('task:end', 'same-0', { status: 'done' }); coalesced++;
  } else {
    // Partially transmit a real Unicode logical event before all-log pressure.
    flow.addFlowCredits(1);
    emit('task:progress', 'chunk-owner', { message: '界😀'.repeat(FLOW_CHUNK_CHARS * 2) });
    chunkFrames = received.at(-1).chunkCount;
    assert.ok(chunkFrames > 1);
    assert.equal(received.at(-1).chunkIndex, 0);
    const remaining = chunkFrames - 1;
    for (let n = 0; n < capacity; n++) emit('log', null, { message: `initial-${n}` });
    dropped += remaining;
    for (let cycle = 0; cycle < cycles; cycle++) {
      for (let n = 0; n < capacity; n++) emit('log', null, { message: `${cycle}-${n}` });
      dropped += capacity;
      assert.equal(flow.buildFlowSnapshot().dropped, dropped);
    }
  }
  const beforeResume = flow.buildFlowSnapshot();
  assert.equal(beforeResume.queueDepth, capacity);
  assert.equal(beforeResume.dropped, dropped);
  assert.equal(beforeResume.coalesced, coalesced);
  assert.equal(beforeResume.lifecycleDropped, lifecycleDropped);
  // Critical action replies remain out-of-band while normal credits are zero.
  const beforeReply = received.length;
  flow.emit('response', { id: 'operator-request', ok: true }, { critical: true });
  assert.equal(received.length, beforeReply + 1);
  assert.equal(received.at(-1).id, 'operator-request');
  assert.equal(flow.buildFlowSnapshot().queueDepth, beforeResume.queueDepth);
  flow.addFlowCredits(10000);
  const resumed = flow.buildFlowSnapshot();
  assert.equal(resumed.queueDepth, 0); assert.equal(resumed.credits, 10000 - capacity);
  assert.equal(resumed.lifecycleDropped, lifecycleDropped);
  assert.equal(resumed.dropped, dropped); assert.equal(resumed.coalesced, coalesced);
  const delivered = received.slice(start).filter(row => row.event !== 'runtime:metrics' && row.event !== 'response');
  if (kind === 'all-log') assert.deepEqual(delivered.filter(row => row.event === 'log').map(row => row.message),
    Array.from({ length: capacity }, (_, n) => `${cycles - 1}-${n + 1}`));
  if (kind === 'no-log') assert.deepEqual(delivered.map(row => row.taskId),
    Array.from({ length: capacity }, (_, n) => `cycle-0-${n}`));
  if (kind === 'mixed') {
    assert.deepEqual(delivered.filter(row => row.event === 'task:progress').map(row => row.taskId).sort(), [
      ...Array.from({ length: capacity / 2 }, (_, n) => `initial-${n * 2 + 1}`),
      ...Array.from({ length: cycles }, (_, cycle) => Array.from({ length: 100 }, (_, n) => `new-${cycle}-${n}`)).flat()
    ].sort());
    assert.equal(delivered.filter(row => row.event === 'log').length, capacity / 2 - 500);
  }
  if (kind === 'coalesced') assert.deepEqual(delivered.filter(row => row.taskId === 'same-0').map(row => [row.event, row.status]),
    [['task:end', 'failed'], ['task:start', undefined], ['task:end', 'done']]);
  if (kind === 'chunks') {
    const frames = received.filter(row => row.event === 'event:chunk');
    assert.equal(frames.length, chunkFrames);
    assert.deepEqual(frames.map(row => row.chunkIndex), Array.from({ length: chunkFrames }, (_, n) => n));
    assert.equal(JSON.parse(frames.map(row => row.chunk).join('')).message, '界😀'.repeat(FLOW_CHUNK_CHARS * 2));
  }
  return { kind, cycles, admissions, peakQueue, wireBytes, counters: flow.buildFlowSnapshot({ includeChunked: true }) };
};

for (const kind of selected === 'work' ? cases.slice(0, -1) : [selected]) {
  const cpu = process.cpuUsage(), memory = process.memoryUsage(), started = performance.now();
  const result = exercise(kind);
  console.log(JSON.stringify({ ...result, elapsedMs: performance.now() - started, cpuMicroseconds: process.cpuUsage(cpu),
    sampledMemoryBefore: memory, sampledMemoryAfter: process.memoryUsage(),
    measurementScope: 'finite in-process actual queue work; endpoint memory samples are not continuous peak RSS' }));
}
