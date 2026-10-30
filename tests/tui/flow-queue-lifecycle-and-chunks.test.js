#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createFlowController } from '../../tools/tui/supervisor/protocol-flow.js';
import { FLOW_DEFAULT_CREDITS, FLOW_QUEUE_MAX } from '../../tools/tui/supervisor/constants.js';

const originalWrite = process.stdout.write;
const received = [];
process.stdout.write = text => { received.push(JSON.parse(String(text))); return true; };
try {
  let seq = 0;
  const flow = createFlowController({ runId: 'fixture-run', nextSeq: () => ++seq, eventLogRecorder: null });
  const emit = (event, taskId, extra = {}, jobId = 'active-job') => {
    flow.emit(event, { taskId, ...extra }, { jobId });
    assert.ok(flow.buildFlowSnapshot().queueDepth <= FLOW_QUEUE_MAX, 'every individual admission respects the hard frame cap');
  };
  for (let index = 0; index < FLOW_DEFAULT_CREDITS; index++) emit('task:progress', 'warm-' + index);
  emit('task:end', 'finished', { status: 'done' });
  for (let index = 0; index < FLOW_QUEUE_MAX + 100; index++) emit('task:progress', 'task-' + index);
  for (let index = 0; index < 100; index++) emit('log', null, { message: 'incoming log' });
  emit('task:progress', 'finished', { status: 'running' });
  flow.addFlowCredits(10000);
  const finished = received.filter(value => value.taskId === 'finished');
  assert.deepEqual(finished.map(value => [value.event, value.status]), [['task:end', 'done']]);
  assert.equal(flow.buildFlowSnapshot().lifecycleDropped, 0);
  assert.ok(flow.buildFlowSnapshot().dropped >= 200);

  // Job/task identities are structural, and explicit task:start is a new
  // instance barrier rather than an invitation to coalesce across completion.
  const baseline = received.length;
  flow.addFlowCredits(1);
  emit('task:start', 'restart'); emit('task:end', 'restart', { status: 'failed' });
  emit('task:start', 'restart'); emit('task:progress', 'restart', { message: 'new attempt' });
  emit('task:end', 'restart', { status: 'done' }, 'other-job');
  flow.addFlowCredits(10000);
  assert.deepEqual(received.slice(baseline).filter(value => value.taskId === 'restart')
    .map(value => [value.jobId, value.event]), [['active-job', 'task:start'], ['active-job', 'task:end'],
    ['active-job', 'task:start'], ['active-job', 'task:progress'], ['other-job', 'task:end']]);

  const saturated = createFlowController({ runId: 'chunk-run', nextSeq: () => ++seq, eventLogRecorder: null });
  for (let index = 0; index < FLOW_DEFAULT_CREDITS - 1; index++) saturated.emit('task:progress', { taskId: String(index) });
  const chunkStart = received.length;
  saturated.emit('task:progress', { taskId: 'large', message: '界😀'.repeat(6000) });
  for (let index = 0; index < FLOW_QUEUE_MAX + 5; index++) saturated.emitLog(null, 'info', 'pressure');
  assert.ok(saturated.buildFlowSnapshot().queueDepth <= FLOW_QUEUE_MAX);
  saturated.addFlowCredits(10000);
  const chunks = received.slice(chunkStart).filter(value => value.event === 'event:chunk');
  assert.equal(chunks.length, chunks[0].chunkCount, 'an already-started logical chunk group must fully drain');
  const rebuilt = JSON.parse(chunks.sort((a, b) => a.chunkIndex - b.chunkIndex).map(value => value.chunk).join(''));
  assert.equal(rebuilt.message, '界😀'.repeat(6000));
} finally { process.stdout.write = originalWrite; }
console.log('TUI flow preserves lifecycle state and whole chunk groups within its hard bound');
