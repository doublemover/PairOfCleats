import { serialize, deserialize } from 'node:v8';
import { observeRuntimeProcess } from '../../../src/shared/runtime-envelope/observe.js';
let generation = null, initialized = null;
process.on('disconnect', () => process.exit(0));
process.on('message', async message => {
  if (message.type === 'initialize') {
    generation = message.generation; initialized = deserialize(message.payload);
    if (initialized.failInitialization) {
      process.send({ type: 'initialization-failed', generation, message: 'controlled initialization failure' });
      process.disconnect(); return;
    }
    const observation = observeRuntimeProcess();
    process.send({ type: 'ready', generation, observation: { ...observation,
      requestedOldSpaceMb: message.oldSpaceMb, resourceLimitAcknowledged: true } });
    return;
  }
  const payload = deserialize(message.payload);
  if (payload.crash) { process.exit(3); return; }
  if (payload.disconnect) { setInterval(() => {}, 1000); process.disconnect(); return; }
  if (payload.retainUntilExit) {
    process.on('SIGTERM', () => {});
    setInterval(() => { if (!payload.bytes?.length) throw new Error('Lost retained input.'); }, 1000);
  }
  process.send({ type: 'worker-task', generation, taskId: message.taskId, status: 'start', task: message.name, durationMs: 0 });
  if (payload.retainUntilExit) return;
  if (payload.stale) process.send({ type: 'result', generation, taskId: 'stale-attempt', payload: serialize('must not publish') });
  await new Promise(resolve => setTimeout(resolve, payload.waitMs || 0));
  process.send({ type: 'result', generation, taskId: message.taskId, rssBytes: process.memoryUsage().rss,
    payload: payload.oversize ? Buffer.alloc(message.outputLimit + 1) : serialize({ id: payload.id, pid: process.pid }) });
});
