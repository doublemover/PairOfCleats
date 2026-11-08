import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSemanticDiskAccount } from '../../src/index/build/artifacts/writers/semantic/partition.js';
import { createRowSpillCollector } from '../../src/index/build/artifacts/helpers.js';
import { mergeRunsWithPlanner, mergeSortedRuns, readJsonlRows, writeJsonlRunFile } from '../../src/shared/merge.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-merge-account-'));
const actualBytes = async directory => {
  let bytes = 0;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    bytes += entry.isDirectory() ? await actualBytes(file) : (await fs.stat(file)).size;
  }
  return bytes;
};
try {
  const owner = createSemanticDiskAccount(4 * 1024 * 1024);
  let peak = 0;
  const account = { reserve(bytes) { owner.reserve(bytes); peak = Math.max(peak, owner.used); },
    release: bytes => owner.release(bytes), get used() { return owner.used; } };
  const collector = createRowSpillCollector({ outDir: root, runPrefix: 'owned', compare: (a, b) => a.id - b.id,
    maxBufferRows: 2, diskAccount: account });
  for (let id = 8; id >= 0; id--) await collector.append({ id, text: '😀' });
  const collected = await collector.finalize();
  assert.equal(account.used, await actualBytes(root), 'spill files are charged before final graph production');
  const directory = path.dirname(collected.runs[0]);
  const options = { runs: collected.runs, compare: (a, b) => a.id - b.id,
    outputPath: path.join(directory, 'ordered.jsonl'), tempDir: directory,
    checkpointPath: path.join(directory, 'checkpoint.json'), plannerHintsPath: path.join(directory, 'hints.json'),
    compareId: 'fixture-integer-order-v1', maxOpenRuns: 2, diskAccount: account };
  const first = await mergeRunsWithPlanner(options);
  assert.equal(account.used, await actualBytes(root), 'intermediate runs, metadata, checkpoints and ordered output share one owner');
  const rows = [];
  for await (const row of readJsonlRows(first.outputPath)) rows.push(row);
  assert.deepEqual(rows.map(row => row.id), [...Array(9).keys()]);
  await first.cleanup();
  assert.equal(account.used, await actualBytes(root));
  const second = await mergeRunsWithPlanner(options);
  assert.equal(account.used, await actualBytes(root), 'replacing an ordered output releases only its retired bytes');
  await second.cleanup();
  assert.ok(peak > account.used, 'atomic replacement and intermediate outputs have overlapping admitted bytes');
  await collected.cleanup();
  assert.equal(account.used, 0, 'closed private spill directory retirement returns exact physical credits');

  const denied = createSemanticDiskAccount(1), deniedPath = path.join(root, 'denied.jsonl');
  await assert.rejects(writeJsonlRunFile(deniedPath, [{ payload: 'large' }], { diskAccount: denied }),
    { code: 'ERR_SEMANTIC_DISK_LIMIT' });
  await assert.rejects(fs.stat(deniedPath), { code: 'ENOENT' });
  assert.equal(denied.used, 0, 'denied first row cannot create an admitted output');
  const primary = new Error('read failed'), cleanup = new Error('reader close failed');
  const readRun = () => ({ [Symbol.asyncIterator]() { return this; },
    async next() { throw primary; }, async return() { throw cleanup; } });
  await assert.rejects(async () => {
    for await (const row of mergeSortedRuns(['owned-run'], { readRun })) void row;
  }, error => error === primary && error.cleanupError.errors[0] === cleanup,
  'reader teardown failure cannot replace the quota/read error owning the failed phase');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('shared spill and staged-merge disk working-set controls passed');
