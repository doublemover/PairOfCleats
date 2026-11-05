import { observeMapProcessMemory } from '../../../tools/bench/map/observation.js';
if (!global.gc) throw new Error('Explicit GC is required only for this transient-memory control.');
const settleCollection = async () => { global.gc(); await new Promise(resolve => setImmediate(resolve)); };
await settleCollection(); await settleCollection();
const before = process.memoryUsage(), requestedBytes = 128 * 1024 * 1024;
// Keep the allocation in a completed synchronous frame. Return numeric witnesses
// only, so suspended module evaluation cannot retain the measured backing store.
const allocateTransient = () => {
  const temporary = Buffer.alloc(requestedBytes, 1);
  let touchedChecksum = 0;
  for (let index = 0; index < temporary.length; index++) touchedChecksum += temporary[index];
  return { during: process.memoryUsage(), checksum: temporary[0] + temporary.at(-1),
    touchedBytes: temporary.length, touchedChecksum };
};
const { during, checksum, touchedBytes, touchedChecksum } = allocateTransient();
// Each explicit collection settles its event-loop turn before the next sample.
await settleCollection(); await settleCollection();
const after = process.memoryUsage();
console.log(JSON.stringify({ before, during, after, checksum, requestedBytes, touchedBytes, touchedChecksum,
  preparationCollections: 2, releaseCollections: 2,
  observation: observeMapProcessMemory({ before, after, through: 'released-explicit-transient-control' }) }));
