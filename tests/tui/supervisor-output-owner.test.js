import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createSupervisorOutput } from '../../tools/tui/supervisor/output.js';
import { createFlowController } from '../../tools/tui/supervisor/protocol-flow.js';

const fixture = () => {
  const stream = new EventEmitter(), writes = [], failures = [];
  stream.write = (value, callback) => { writes.push({ value, callback }); return false; };
  const output = createSupervisorOutput({ stream, onFailure: error => failures.push(error) });
  return { stream, writes, failures, output };
};
{
  const { stream, writes, output } = fixture();
  assert.equal(output.write('final event\n'), false, 'ordinary backpressure is not failure');
  assert.equal(output.inspect().failed, false);
  let drained = false;
  const draining = output.drain().then(value => { drained = true; return value; });
  await Promise.resolve();
  assert.equal(drained, false, 'drain waits for the real write callback');
  writes[0].callback();
  assert.equal((await draining).complete, true);
  assert.equal(stream.listenerCount('error'), 1);
  output.dispose();
  assert.equal(stream.listenerCount('error'), 0);
}
{
  const { stream, writes, failures, output } = fixture();
  const recorded = [];
  let seq = 0;
  const flow = createFlowController({ runId: 'broken-output', nextSeq: () => ++seq,
    output, eventLogRecorder: { write: event => recorded.push(event) } });
  flow.emit('job:start', { title: 'owned' }, { jobId: 'owned' });
  const broken = Object.assign(new Error('broken exact pipe'), { code: 'EPIPE' });
  writes[0].callback(broken);
  stream.emit('error', broken);
  stream.emit('close');
  await Promise.resolve();
  assert.deepEqual(failures, [broken], 'callback, error and close request one shutdown');
  assert.throws(() => output.assertWritable(), error => error === broken, 'preserve the original transport fault');
  assert.doesNotThrow(() => flow.emit('job:end', { status: 'cancelled' }, { jobId: 'owned' }));
  assert.equal(writes.length, 1, 'failed wire never receives further writes');
  assert.deepEqual(recorded.map(event => event.event), ['job:start', 'job:end'],
    'durable final events survive a failed transport');
  assert.equal((await output.drain()).complete, false, 'failure is never a flush receipt');
  output.dispose();
}
{
  const { stream, failures, output } = fixture();
  const error = Object.assign(new Error('synchronous write failure'), { code: 'EBADF' });
  stream.write = () => { throw error; };
  assert.equal(output.write('event'), false);
  await Promise.resolve();
  assert.deepEqual(failures, [error]);
  assert.equal(output.inspect().pendingWrites, 0);
  output.dispose();
}
{
  const { output } = fixture();
  output.write('no callback yet');
  const result = await output.drain({ timeoutMs: 1 });
  assert.equal(result.complete, false);
  assert.equal(result.timedOut, true);
  assert.equal(result.pendingWrites, 1, 'an expired flush deadline cannot manufacture callback settlement');
  output.dispose();
}
console.log('Supervisor output observes exact write settlement, backpressure and durable events after pipe failure');
