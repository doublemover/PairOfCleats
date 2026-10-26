import { parentPort, threadId as nativeId } from 'node:worker_threads';
import { serialize, deserialize } from 'node:v8';
import { observeRuntimeProcess } from '../../../src/shared/runtime-envelope/observe.js';
import { createWorkerObserver, projectWorkerError, withWorkerTaskObservation } from '../../../src/index/build/workers/observation.js';
import { installWorkerFatalPolicy } from '../../../src/index/build/workers/fatal-policy.js';

let generation = null;
const id = parentPort ? nativeId : process.pid;
const send = (message, onError = () => {}) => parentPort ? parentPort.postMessage(message) : process.send?.({ ...message, generation }, onError);
const observer = createWorkerObserver({ send });
const policy = installWorkerFatalPolicy({ threadId: id, send, observer });
const execute = withWorkerTaskObservation(async payload => {
  if (policy.isPoisoned()) throw new Error('Attempt to reuse fatal owner.');
  if (payload.mode === 'ordinary') throw new Error('ordinary controlled task failure');
  for (let i = 0; i < (payload.flood || 0); i++) observer.emit({ type: 'worker-task', threadId: id,
    task: 'fixture', status: 'ok', durationMs: i });
  if (payload.mode === 'exception' || payload.mode === 'rejection') {
    setImmediate(() => {
      if (payload.mode === 'exception') throw new Error('controlled asynchronous fatal');
      Promise.reject(false);
    });
    return new Promise(() => {});
  }
  return { value: payload.value, id, observation: observer.stats() };
}, { observer, threadId: id, task: 'fixture' });
export const run = execute;

if (parentPort) parentPort.on('message', message => observer.acknowledge(message));
else {
  process.on('disconnect', () => process.exit(0));
  process.on('message', async message => {
    if (message.type === 'worker-observation-ack') { observer.acknowledge(message); return; }
    if (message.type === 'initialize') {
      generation = message.generation;
      send({ type: 'ready', observation: { ...observeRuntimeProcess(), requestedOldSpaceMb: message.oldSpaceMb,
        resourceLimitAcknowledged: true } }); return;
    }
    if (message.type !== 'task' || message.generation !== generation || policy.isPoisoned()) return;
    const payload = deserialize(message.payload);
    if (payload.mode === 'report-only') {
      // Protocol-only control: deliberately stay alive and offer a late result.
      // The parent must retain ownership even if its first stop fails.
      send({ type: 'worker-fatal', version: 1, threadId: id, reason: 'uncaughtException' });
      send({ type: 'result', taskId: message.taskId, payload: serialize({ late: true }) });
      setInterval(() => {}, 1000); return;
    }
    try {
      const result = await execute(payload);
      if (!policy.isPoisoned()) send({ type: 'result', taskId: message.taskId,
        payload: serialize(result), rssBytes: process.memoryUsage().rss });
    } catch (error) {
      const detail = projectWorkerError(error);
      send({ type: 'result', taskId: message.taskId, error: { message: detail.message,
        name: detail.name || 'Error', code: detail.code || 'ERR_FIXTURE_TASK' } });
    }
  });
}
