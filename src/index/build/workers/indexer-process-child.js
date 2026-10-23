import { serialize, deserialize } from 'node:v8';
import { observeRuntimeProcess, getNodeStartupInputs } from '../../../shared/runtime-envelope/observe.js';
import { resolveNodeHeapSource } from '../../../shared/workers/node-argv.js';

let generation = null, tasks = null, maxMessageBytes = 0, busy = false;
const send = message => process.send?.({ ...message, generation });
process.on('disconnect', () => process.exit(0));
process.on('message', async message => {
  if (message?.type === 'initialize' && generation == null) {
    generation = message.generation; maxMessageBytes = message.maxMessageBytes;
    try {
      if (!Buffer.isBuffer(message.payload) || message.payload.length > maxMessageBytes) throw new Error('Invalid bounded process initialization.');
      const data = deserialize(message.payload);
      const observation = observeRuntimeProcess();
      const startup = resolveNodeHeapSource(getNodeStartupInputs());
      Object.assign(observation, { execution: 'process', requestedOldSpaceMb: message.oldSpaceMb,
        parentAttemptId: data.runtimeAttemptId || null, buildId: data.buildId || null,
        workerAttemptId: observation.processInstanceId,
        resourceLimitAcknowledged: startup.value === message.oldSpaceMb
          && observation.heapSizeLimitBytes <= (message.oldSpaceMb + 40) * 1024 * 1024,
        limitCheckMethod: 'independent-child-startup-old-space-and-measured-V8-total-heap' });
      if (!observation.resourceLimitAcknowledged) throw new Error('Child startup heap contract is not enforceable.');
      globalThis.__indexerTaskProcessData = data;
      globalThis.__indexerTaskProcessGeneration = generation;
      globalThis.__indexerTaskProcessObservation = observation;
      tasks = await import('./indexer-worker.js');
      send({ type: 'ready', observation });
    } catch (error) { send({ type: 'initialization-failed', message: error.message }); process.exitCode = 1; process.disconnect(); }
    return;
  }
  if (message?.type !== 'task' || message.generation !== generation || !tasks || busy) return;
  busy = true;
  try {
    if (!['tokenizeChunk', 'tokenizeBatch', 'quantizeVectors', 'analyzeFile'].includes(message.name) || !Buffer.isBuffer(message.payload)
      || message.payload.length > maxMessageBytes) throw new Error('Invalid bounded process task.');
    const result = await tasks[message.name](deserialize(message.payload));
    const payload = serialize(result);
    if (payload.length > Math.min(message.outputLimit, maxMessageBytes)) throw Object.assign(new Error('Task result exceeds reserved output bytes.'), { code: 'ERR_PROCESS_TASK_BUDGET' });
    send({ type: 'result', taskId: message.taskId, payload, rssBytes: process.memoryUsage().rss });
  } catch (error) { send({ type: 'result', taskId: message.taskId,
    error: { code: error.code || 'ERR_PROCESS_TASK', message: String(error.message).slice(0, 2048) }, rssBytes: process.memoryUsage().rss }); }
  finally { busy = false; }
});
