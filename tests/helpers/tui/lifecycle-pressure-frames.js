import assert from 'node:assert/strict';
import { createFlowController } from '../../../tools/tui/supervisor/protocol-flow.js';
import { FLOW_DEFAULT_CREDITS, FLOW_QUEUE_MAX } from '../../../tools/tui/supervisor/constants.js';

let sequence = 0;
const flow = createFlowController({ runId: 'native-pressure', nextSeq: () => ++sequence });
const emit = (event, jobId, taskId, payload = {}) => {
  flow.emit(event, { taskId, ...payload }, { jobId });
  assert.ok(flow.buildFlowSnapshot().queueDepth <= FLOW_QUEUE_MAX);
};
for (const jobId of ['active-a', 'active-b']) flow.emit('job:start', { title: jobId }, { jobId });
for (let n = 0; n < FLOW_DEFAULT_CREDITS; n++) emit('task:progress', 'active-a', `warm-${n}`);
if (process.argv[2] === 'loss') {
  emit('task:start', 'active-a', 'lost-terminal');
  for (let n = 1; n < FLOW_QUEUE_MAX; n++) emit('task:start', 'active-a', `retained-start-${n}`);
  emit('task:end', 'active-a', 'lost-terminal', { status: 'done' });
  assert.equal(flow.buildFlowSnapshot().lifecycleDropped, 1);
  assert.equal(flow.buildFlowSnapshot().dropped, 1);
  flow.emit('job:end', { status: 'failed' }, { jobId: 'independent-terminal' });
  flow.addFlowCredits(10000);
  assert.equal(flow.buildFlowSnapshot().queueDepth, 0);
} else {
  for (const job of ['active-a', 'active-b']) {
    for (const status of ['done', 'failed']) {
      emit('task:start', job, status);
      emit('task:progress', job, status, { current: 1 });
      emit('task:end', job, status, { status, message: '終😀'.repeat(9000) });
      emit('task:progress', job, status, { status: 'running', message: 'stale' });
    }
    emit('task:start', job, 'restart');
    emit('task:end', job, 'restart', { status: 'failed' });
    emit('task:start', job, 'restart');
    emit('task:progress', job, 'restart', { current: 2, message: 'second attempt' });
    emit('task:end', job, 'restart', { status: 'done' });
    emit('task:start', job, 'still-active');
  }
  for (let cycle = 0; cycle < 5; cycle++) {
    for (let n = 0; n < FLOW_QUEUE_MAX; n++) emit('task:progress', 'pressure', `unrelated-${cycle}-${n}`);
    emit('log', 'pressure', null, { message: 'no safe log victim for this incoming log' });
  }
  assert.equal(flow.buildFlowSnapshot().lifecycleDropped, 0);
  assert.ok(flow.buildFlowSnapshot().coalesced >= 4);
  flow.addFlowCredits(1);
  assert.ok(flow.buildFlowSnapshot().queueDepth > 0, 'partial credit is not a full resume');
  flow.addFlowCredits(10000);
  assert.equal(flow.buildFlowSnapshot().queueDepth, 0);
  flow.emitRuntimeMetrics();
}
