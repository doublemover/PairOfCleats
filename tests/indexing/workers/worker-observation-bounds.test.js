import assert from 'node:assert/strict';
import util from 'node:util';
import { createWorkerObserver, createWorkerObservation, readWorkerObservation, projectWorkerError,
  createWorkerTaskError, withWorkerTaskObservation, WORKER_OBSERVATION_BYTES,
  WORKER_OBSERVATION_QUEUE_BYTES, WORKER_OBSERVATION_QUEUE_EVENTS } from '../../../src/index/build/workers/observation.js';

let invoked = 0;
const unsafe = Object.create(null);
for (const key of ['name', 'message', 'stack', 'cause', 'code']) Object.defineProperty(unsafe, key, {
  get() { invoked++; throw new Error('Diagnostic getter executed.'); }
});
unsafe[util.inspect.custom] = () => { invoked++; throw new Error('Custom inspection executed.'); };
projectWorkerError(unsafe);
projectWorkerError(new Proxy({}, { getOwnPropertyDescriptor() { invoked++; throw new Error('Proxy inspected.'); } }));
assert.equal(invoked, 0);

const cyclic = { message: 'first cause' }; cyclic.cause = cyclic;
assert.equal(projectWorkerError(cyclic).cause.message, '[unavailable or cyclic error]');
assert.equal(projectWorkerError(cyclic).droppedFields, 1);
const detail = projectWorkerError({ name: 'TypeError', code: 'CONTROLLED',
  message: '😀'.repeat(100000), stack: '界'.repeat(100000), cause: { message: 'é'.repeat(100000) } });
assert.equal(detail.message, '😀'.repeat(192));
assert.equal(detail.retainedTextBytes <= 2048, true);
assert.equal(detail.truncatedFields, 3, 'all three long text fields record truncation');
assert.equal(detail.code, 'CONTROLLED');
for (const original of [null, undefined, false, 0, '', 'ordinary failure']) {
  const wrapped = createWorkerTaskError(original, 'fixture');
  assert.equal(wrapped.cause, original, 'bounded transport retains the primitive first cause');
  const task = withWorkerTaskObservation(async () => { throw original; }, {
    observer: { emit() { throw new Error('observation send failure'); } }, threadId: 1, task: 'fixture'
  });
  let caught = false;
  try { await task(); } catch (error) { caught = true; assert.equal(error, original); }
  assert.equal(caught, true, 'falsey throw is not converted into success');
}
const success = withWorkerTaskObservation(async value => value, {
  observer: { emit() { throw new Error('observation failure'); } }, threadId: 1, task: 'fixture'
});
const result = { exact: 'result' }; assert.equal(await success(result), result);

for (const text of ['\u0000'.repeat(100000), '😀'.repeat(100000)]) {
  const envelope = createWorkerObservation({ type: 'worker-crash', threadId: 7, task: 'x'.repeat(100000),
    error: { message: text, stack: text, cause: { message: text, cause: unsafe } } }, 1);
  assert.ok(envelope); assert.ok(Buffer.byteLength(JSON.stringify(envelope)) <= WORKER_OBSERVATION_BYTES);
  const admitted = readWorkerObservation({ ...envelope, raw: 'not admitted', source: () => {} });
  assert.equal(admitted.threadId, 7); assert.equal(Object.hasOwn(admitted, 'raw'), false);
  assert.equal(admitted.diagnosticErrorCapture.truncatedFields > 0, true);
}
assert.equal(readWorkerObservation({ type: 'worker-observation', version: 2, sequence: 1 }), null);
assert.equal(createWorkerObservation({ type: 'worker-runtime', threadId: 7,
  observation: { buildId: 'x'.repeat(100000) } }, 1), null, 'identity is omitted rather than truncated into a false correlation');
assert.equal(invoked, 0);

const sent = [], observer = createWorkerObserver({ send: message => { sent.push(message); return false; } });
for (let i = 0; i < 10000; i++) observer.emit({ type: 'worker-task', threadId: 3, task: 'tokenize', status: 'ok', durationMs: i });
assert.equal(sent.length, 1, 'transport backpressure is not a request to resend or enqueue more frames in IPC');
assert.equal(observer.stats().queuedEvents, WORKER_OBSERVATION_QUEUE_EVENTS);
assert.ok(observer.stats().peakBytes <= WORKER_OBSERVATION_QUEUE_BYTES);
assert.equal(observer.stats().dropped, 10000 - WORKER_OBSERVATION_QUEUE_EVENTS);
observer.acknowledge({ type: 'worker-observation-ack', version: 1, sequence: 0 });
assert.equal(sent.length, 1, 'stale ack cannot release the current frame');
while (observer.stats().queuedEvents) observer.acknowledge({ type: 'worker-observation-ack', version: 1, sequence: sent.at(-1).sequence });
assert.equal(observer.stats().retainedBytes, 0);
assert.equal(sent.at(-1).event.durationMs, 9999, 'bounded FIFO retains the final state after shedding old events');
assert.equal(sent.at(-1).delivery.dropped, 10000 - WORKER_OBSERVATION_QUEUE_EVENTS);
const broken = createWorkerObserver({ send() { throw new Error('IPC unavailable'); } });
for (let i = 0; i < 50; i++) broken.emit({ type: 'worker-task-start', threadId: 4 });
assert.equal(broken.stats().sendFailures, 50); assert.equal(broken.stats().retainedBytes, 0);
let failDelivery;
const asynchronous = createWorkerObserver({ send: (_message, callback) => { failDelivery = callback; } });
for (let i = 0; i < 5; i++) asynchronous.emit({ type: 'worker-task-start', threadId: 4 });
failDelivery(new Error('Asynchronous IPC failure'));
assert.equal(asynchronous.stats().sendFailures, 1); assert.equal(asynchronous.stats().dropped, 5);
assert.equal(asynchronous.stats().retainedBytes, 0);
assert.equal(await withWorkerTaskObservation(async () => 42, { observer: asynchronous, threadId: 4, task: 'fixture' })(), 42);
assert.equal(asynchronous.stats().dropped, 7, 'failed diagnostic channel remains bounded without disabling tasks');
console.log('Worker observations bound encoded bytes and queued ownership without changing original task outcomes.');
