import { parentPort, workerData } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { openSemanticFrontier } from '../../src/index/semantic/frontier.js';
import { createSemanticDiskAccount } from '../../src/index/build/artifacts/writers/semantic/partition.js';
import { writeIncrementalBundle } from '../../src/index/build/incremental/writeback.js';

// Deliberately remain alive with a leased task after the durable file commit.
// The parent terminates this owned worker before any manifest/publication save.
const { filename, task, bundleInput, start } = workerData;
Atomics.add(start, 0, 1);
Atomics.notify(start, 0);
while (Atomics.load(start, 0) < 2) Atomics.wait(start, 0, 1, 1000);
const control = openSemanticFrontier({ Database, filename });
control.enqueue({ task, durableInputHashes: new Set(task.inputHashes) });
control.leaseReady({ baseBuildId: task.baseBuildId, taskId: task.taskId, owner: task.taskId,
  now: 100, leaseMs: 100, limit: 1 });
const entry = await writeIncrementalBundle({ ...bundleInput,
  semanticContext: { ...bundleInput.semanticContext, diskAccount: createSemanticDiskAccount(16 * 1024 * 1024) } });
parentPort.postMessage(entry);
parentPort.on('message', () => {});
