import { observeMapProcessMemory } from '../../../tools/bench/map/observation.js';
if (!global.gc) throw new Error('Explicit GC is required only for this transient-memory control.');
const allocationKind = process.argv[2] || 'rss-transient';
if (!['buffer-disposal', 'rss-transient'].includes(allocationKind)) throw new Error('Unknown transient control.');
const settleCollection = async () => { global.gc(); await new Promise(resolve => setImmediate(resolve)); };
await settleCollection(); await settleCollection();
const before = process.memoryUsage(), requestedBytes = 128 * 1024 * 1024;
// Keep the allocation in a completed synchronous frame. Return numeric witnesses
// only, so suspended module evaluation cannot retain the measured backing store.
const allocateTransient = () => {
  // Ordinary Buffers return to the embedder's malloc allocator, which can retain
  // freed pages. Resizable backing stores have a separate page-allocation owner;
  // destroying that store releases its mapping rather than a malloc cache entry.
  const temporary = allocationKind === 'buffer-disposal' ? Buffer.alloc(requestedBytes, 1)
    : new Uint8Array(new ArrayBuffer(requestedBytes, { maxByteLength: requestedBytes }));
  if (allocationKind === 'rss-transient') temporary.fill(1);
  let touchedChecksum = 0;
  for (let index = 0; index < temporary.length; index++) touchedChecksum += temporary[index];
  return { during: process.memoryUsage(), checksum: temporary[0] + temporary.at(-1),
    touchedBytes: temporary.length, touchedChecksum };
};
const { during, checksum, touchedBytes, touchedChecksum } = allocateTransient();
// Each explicit collection settles its event-loop turn before the next sample.
await settleCollection(); await settleCollection();
const after = process.memoryUsage();
console.log(JSON.stringify({ allocationKind, before, during, after, checksum, requestedBytes, touchedBytes, touchedChecksum,
  preparationCollections: 2, releaseCollections: 2,
  observation: observeMapProcessMemory({ before, after, through: 'released-explicit-transient-control' }) }));
