import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeJsonLinesSharded, writeJsonLinesShardedAsync } from '../../../src/shared/json-stream/jsonl-sharded.js';
import { replaceDir } from '../../../src/shared/io/replace-dir.js';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-sharded-disk-'));
const physicalBytes = async directory => {
  let bytes = 0;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    bytes += entry.isDirectory() ? await physicalBytes(filename) : (await fs.stat(filename)).size;
  }
  return bytes;
};
try {
  const output = path.join(root, 'output'); await fs.mkdir(output);
  const owner = createSemanticDiskAccount(4 * 1024 * 1024);
  let peak = 0;
  const account = { reserve(bytes) { owner.reserve(bytes); peak = Math.max(peak, owner.used); },
    release: bytes => owner.release(bytes), get used() { return owner.used; } };
  const items = (async function* () {
    yield { id: 1, text: '😀', vec: new Uint8Array([1, 2]) };
    assert.ok(await physicalBytes(output) <= account.used,
      'large shard capacity cannot preallocate unadmitted physical bytes after the first small row');
    yield { id: 2, text: 'second' };
  })();
  const first = await writeJsonLinesShardedAsync({ dir: output, partsDirName: 'parts', partPrefix: 'part-', items,
    maxBytes: 16 * 1024 * 1024, offsets: { suffix: 'offsets.bin' }, diskAccount: account });
  assert.equal(account.used, await physicalBytes(output));
  const rows = (await fs.readFile(path.join(output, first.parts[0]), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(rows[0].vec, [1, 2]);
  await writeJsonLinesSharded({ dir: output, partsDirName: 'parts', partPrefix: 'part-', items: [{ replacement: true }],
    maxBytes: 1024, offsets: { suffix: 'offsets.bin' }, diskAccount: account });
  assert.equal(account.used, await physicalBytes(output), 'closed replacement retires old rows and offsets after promotion');
  assert.ok(peak > account.used);

  const quota = path.join(root, 'quota'); await fs.mkdir(quota);
  let closed = 0;
  const cleanup = new Error('input close failed');
  const deniedItems = (function* () { try { yield { text: 'first' }; yield { text: 'second' }; }
    finally { closed++; throw cleanup; } })();
  const denied = createSemanticDiskAccount(1);
  await assert.rejects(writeJsonLinesSharded({ dir: quota, partsDirName: 'parts', partPrefix: 'part-', items: deniedItems,
    maxBytes: 1024, diskAccount: denied }), error => error.code === 'ERR_SEMANTIC_DISK_LIMIT' && error.cleanupError === cleanup);
  assert.equal(closed, 1, 'quota denial settles the input generator before returning its primary failure');
  assert.equal(denied.used, 0); assert.equal(await physicalBytes(quota), 0);
  await assert.rejects(writeJsonLinesSharded({ dir: quota, partsDirName: 'compressed', partPrefix: 'part-', items: [],
    maxBytes: 1024, compression: 'gzip', diskAccount: account }), /uncompressed writer/);

  const temp = path.join(root, 'promotion-temp'), final = path.join(root, 'promotion-final');
  await fs.mkdir(temp); await fs.mkdir(final);
  await fs.writeFile(path.join(temp, 'new'), 'new'); await fs.writeFile(path.join(final, 'old'), 'old');
  const rename = fs.rename, copy = fs.cp, renameFailure = Object.assign(new Error('owned rename denied'), { code: 'EXDEV' });
  let copies = 0;
  fs.rename = async (from, to) => { if (from === temp && to === final) throw renameFailure; return rename(from, to); };
  fs.cp = async (...args) => { copies++; return copy(...args); };
  try {
    await assert.rejects(replaceDir(temp, final, { keepBackup: true, allowCopyFallback: false }), error => error === renameFailure);
    assert.equal(copies, 0, 'owned sharded promotion cannot create an unreserved fallback directory copy');
    assert.equal(await fs.readFile(path.join(final, 'old'), 'utf8'), 'old');
  } finally { fs.rename = rename; fs.cp = copy; }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('sharded row/offset disk admission, replacement and closed-failure controls passed');
