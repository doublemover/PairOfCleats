import { observeMapProcessMemory } from '../../../tools/bench/map/observation.js';
if (!global.gc) throw new Error('Explicit GC is required only for this transient-memory control.');
global.gc();
const before = process.memoryUsage();
let temporary = Buffer.alloc(128 * 1024 * 1024, 1);
const during = process.memoryUsage(), checksum = temporary[0] + temporary.at(-1);
temporary = null;
global.gc(); await new Promise(resolve => setImmediate(resolve)); global.gc();
const after = process.memoryUsage();
console.log(JSON.stringify({ before, during, after, checksum,
  observation: observeMapProcessMemory({ before, after, through: 'released-explicit-transient-control' }) }));
