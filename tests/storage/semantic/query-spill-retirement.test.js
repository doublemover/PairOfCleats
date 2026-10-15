import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeSemanticQueryIndex } from '../../../src/index/build/artifacts/writers/semantic/query-index.js';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { canonicalSemanticJson } from '../../../src/index/semantic/identity.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-query-spill-retirement-'));
const generation = { baseBuildId: 'spill-fixture', semanticRevision: 0 };
const entries = Array.from({ length: 40 }, (_, id) => ({ id, value: 'entry-' + String(id).padStart(3, '0') }));
const unsorted = [...entries].reverse();
const bytes = entries.reduce((sum, entry) => sum + Buffer.byteLength(canonicalSemanticJson(entry)) + 1, 0);
const options = { generation, partitions: [], store: null, entries: unsorted,
  compareRows: (a, b) => a.id - b.id, keyForRow: row => String(row.id), validateIndex: index => index, batchBytes: 4096 };
const read = async (directory, index) => {
  const rows = [], hashes = [], offsetsHashes = [];
  for (const piece of index.pieces) {
    rows.push(...(await fs.readFile(path.join(directory, piece.path), 'utf8')).trim().split('\n').map(JSON.parse));
    hashes.push(piece.hash); offsetsHashes.push(piece.offsetsHash);
  }
  return { rows, hashes, offsetsHashes };
};
try {
  const source = path.join(root, 'published-source-part.jsonl');
  await fs.writeFile(source, 'immutable source partition\n');
  const baselineRoot = path.join(root, 'baseline'), spillRoot = path.join(root, 'spilled');
  const baselineAccount = createSemanticDiskAccount(1024 * 1024);
  const baseline = await writeSemanticQueryIndex({ ...options, root: baselineRoot, diskAccount: baselineAccount,
    batchRows: 2, maxOpenRuns: 64 });
  const metrics = {}, account = createSemanticDiskAccount(bytes * 2 + entries.length * 8);
  const started = performance.now();
  const spilled = await writeSemanticQueryIndex({ ...options, root: spillRoot, diskAccount: account,
    batchRows: 2, maxOpenRuns: 2, metrics,
    onMergeGroup: async ({ target, workingBytes }) => {
      assert.ok((await fs.stat(target)).size > 0, 'replacement exists before retirement receipt');
      assert.ok(workingBytes <= bytes, 'obsolete input levels are removed between groups');
      assert.equal(await fs.readFile(source, 'utf8'), 'immutable source partition\n');
    } });
  const wallMs = performance.now() - started;
  assert.ok(metrics.mergePasses >= 3, 'fixture exercises at least three intermediate levels');
  assert.ok(metrics.peakWorkingBytes <= bytes * 2, 'peak tracks an active frontier plus one replacement');
  assert.equal(metrics.workingBytes, 0);
  assert.equal(account.used, bytes + entries.length * 8, 'only physical final rows and offsets remain charged');
  assert.equal(account.used, baselineAccount.used);
  assert.deepEqual(await read(spillRoot, spilled), await read(baselineRoot, baseline));
  const files = await fs.readdir(path.join(spillRoot, path.dirname(spilled.pieces[0].path)));
  assert.ok(files.every(name => name.startsWith('index-')), 'no owned spill runs remain after publication');
  for (let failGroup = 1; failGroup <= metrics.mergeGroups; failGroup += 1) {
    const failRoot = path.join(root, 'failure-' + failGroup), failedAccount = createSemanticDiskAccount(1024 * 1024);
    let groups = 0;
    await assert.rejects(writeSemanticQueryIndex({ ...options, root: failRoot, diskAccount: failedAccount,
      batchRows: 2, maxOpenRuns: 2, onMergeGroup: () => { if (++groups === failGroup) throw new Error('injected merge failure'); } }), /injected merge failure/);
    assert.equal(failedAccount.used, 0, 'retired credits are never released twice after failure');
    assert.deepEqual(await fs.readdir(failRoot), [], 'owned partial merge directory is removed');
    assert.equal(await fs.readFile(source, 'utf8'), 'immutable source partition\n');
  }
  // Capacity refusal before replacement completion also clears only task-owned bytes.
  const denied = createSemanticDiskAccount(bytes + 1);
  await assert.rejects(writeSemanticQueryIndex({ ...options, root: path.join(root, 'denied'), diskAccount: denied,
    batchRows: 2, maxOpenRuns: 2 }), { code: 'ERR_SEMANTIC_DISK_LIMIT' });
  assert.equal(denied.used, 0);
  console.log(JSON.stringify({ fixture: 'query-spill-retirement', inputBytes: bytes, wallMs, metrics }));
} finally { await fs.rm(root, { recursive: true, force: true }); }
