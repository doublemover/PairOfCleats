import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Session } from 'node:inspector/promises';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';

/** Separate sampled JS allocation pass; never use its timings as clean latency. */
export const observeHeapAllocations = async ({ destination, name, operation, iterations = 16 }) => {
  assert.ok(path.isAbsolute(destination));
  assert.match(name, /^[a-zA-Z0-9_-]+$/);
  assert.ok(Number.isSafeInteger(iterations) && iterations > 0 && iterations <= 64);
  const session = new Session(); session.connect(); let failure, hasFailure = false, profile, samplingStarted = false;
  try {
    await session.post('HeapProfiler.startSampling', { samplingInterval: 32768,
      includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    samplingStarted = true;
    for (let index = 0; index < iterations; index++) await operation();
  } catch (error) { failure = error; hasFailure = true; }
  finally {
    if (samplingStarted) {
      try { ({ profile } = await session.post('HeapProfiler.stopSampling')); }
      catch (cleanup) { failure = hasFailure ? addStorageFailureContext(failure, { phase: 'original-inspector-stop' }, cleanup,
        { secondaryPresent: true }) : cleanup; hasFailure = true; }
    }
    try { session.disconnect(); }
    catch (cleanup) { failure = hasFailure ? addStorageFailureContext(failure, { phase: 'original-inspector-disconnect' }, cleanup,
      { secondaryPresent: true }) : cleanup; hasFailure = true; }
  }
  if (hasFailure) throw failure;
  assert.ok(profile.samples.length <= 50000, 'Bounded workload must fit the recorded sampling budget.');
  const nodes = [], pending = [[profile.head, null]];
  while (pending.length) {
    const [node, parentId] = pending.pop(); assert.ok(nodes.length < 50000);
    nodes.push({ id: node.id, parentId, selfSize: node.selfSize, ...node.callFrame });
    for (const child of node.children || []) pending.push([child, node.id]);
  }
  const file = path.join(destination, name + '-allocation.json');
  const bytes = JSON.stringify({ samplingInterval: 32768, includeCollectedMajorAndMinor: true, nodes, samples: profile.samples });
  assert.ok(Buffer.byteLength(bytes) <= 4 * 1024 * 1024);
  await fs.writeFile(file, bytes + '\n', { flag: 'wx' });
  return { path: file, sha256: createHash('sha256').update(bytes + '\n').digest('hex'), bytes: Buffer.byteLength(bytes) + 1,
    iterations, sampledBytes: profile.samples.reduce((sum, sample) => sum + sample.size, 0), sampleCount: profile.samples.length,
    scope: 'separate V8 Poisson heap-allocation observation, including collected objects;not exact allocations, native bytes, retained heap or clean latency' };
};
