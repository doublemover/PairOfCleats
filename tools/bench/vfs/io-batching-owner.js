import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { persistenceDirectoryIdentity, assertPersistenceDirectoryIdentity } from '../../../src/shared/io/directory-identity.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { summarizeDurations } from '../micro/utils.js';

const MODES = new Set(['both', 'unbatched', 'batched']);

/** The selected output directory is a container. Only its exclusively created
 * run child belongs to this invocation, including after partial write failure.
 */
export const runIoBatching = async ({ fileCount, payloadSize, batchSize, mode = 'both', outDir, keep = false }) => {
  if (!MODES.has(mode)) throw new RangeError(`Unsupported I/O batching mode: ${mode}`);
  if (![fileCount, payloadSize, batchSize].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new RangeError('I/O batching requires positive integer file, payload and batch sizes.');
  }
  const selectedParent = path.resolve(outDir || os.tmpdir());
  await fs.mkdir(selectedParent, { recursive: true });
  const parent = await fs.realpath(selectedParent);
  const parentIdentity = persistenceDirectoryIdentity(await fs.lstat(parent, { bigint: true }));
  const baseDir = await fs.mkdtemp(path.join(parent, 'poc-vfs-io-'));
  let identity, primary, failed = false;
  try {
    identity = persistenceDirectoryIdentity(await fs.lstat(baseDir, { bigint: true }));
    const results = { generatedAt: new Date().toISOString(), baseDir, files: fileCount,
      payloadSize, batchSize, bench: {} };
    const payload = Buffer.alloc(payloadSize, 0x61);
    for (const label of ['unbatched', 'batched']) {
      if (mode !== 'both' && mode !== label) continue;
      results.bench[label] = await runWriteBench({ label, dir: path.join(baseDir, label),
        fileCount, payload, batchSize: label === 'batched' ? batchSize : 1 });
    }
    return results;
  } catch (error) { primary = error; failed = true; throw error; }
  finally {
    if (!keep) {
      try {
        if (failed) observeStorageResource(primary, { phase: 'vfs-io-benchmark-writes' }).requireSettled();
        // A replaced root or parent is retained, never adopted as cleanup work.
        assertPersistenceDirectoryIdentity(await fs.lstat(parent, { bigint: true }), parentIdentity);
        assertPersistenceDirectoryIdentity(await fs.lstat(baseDir, { bigint: true }), identity);
        if (path.dirname(baseDir) !== parent || path.relative(parent, await fs.realpath(baseDir)) !== path.basename(baseDir)) {
          throw new Error('Benchmark run directory no longer identifies its owned child.');
        }
        await fs.rm(baseDir, { recursive: true });
      } catch (error) {
        if (failed) throw addStorageFailureContext(primary, { benchmarkRunDirectory: baseDir }, error, { secondaryPresent: true });
        throw error;
      }
    }
  }
};

const runWriteBench = async ({ label, dir, fileCount, payload, batchSize }) => {
  await fs.mkdir(dir);
  const start = process.hrtime.bigint();
  for (let i = 0; i < fileCount; i += batchSize) {
    const tasks = [];
    const limit = Math.min(fileCount, i + batchSize);
    for (let j = i; j < limit; j++) tasks.push(Promise.resolve().then(() => fs.writeFile(path.join(dir, `doc-${j}.bin`), payload, { flag: 'wx' })));
    // A rejected writer does not cancel the other admitted writers. Join all of
    // them before exposing failure to the run-directory cleanup owner.
    const settled = await Promise.allSettled(tasks);
    const failures = settled.filter(result => result.status === 'rejected').map(result => result.reason);
    if (failures.length) {
      throw failures.slice(1).reduce((error, sibling) => addStorageFailureContext(error, {}, sibling,
        { secondaryPresent: true }), failures[0]);
    }
  }
  const totalMs = Number(process.hrtime.bigint() - start) / 1e6;
  const bytesWritten = fileCount * payload.length;
  return { label, totalMs, stats: summarizeDurations([totalMs]), filesWritten: fileCount,
    bytesWritten, bytesPerSec: totalMs > 0 ? bytesWritten / (totalMs / 1000) : 0 };
};
