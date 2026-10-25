import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runIoBatching } from '../../../tools/bench/vfs/io-batching-owner.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

const { dir } = await prepareIsolatedTestCacheDir('vfs-io-ownership');
const parent = path.join(dir, 'caller-output');
await fs.mkdir(path.join(parent, 'batched'), { recursive: true });
const sentinel = path.join(parent, 'batched', 'doc-0.bin');
await fs.writeFile(sentinel, 'caller-owned');
const options = { fileCount: 4, payloadSize: 8, batchSize: 2, outDir: parent };
const env = applyTestEnv({ syncProcess: false, extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const cli = ['tools/bench/vfs/io-batching.js', '--files', '4', '--size', '8', '--batch', '2', '--outDir', parent, '--json'];
for (const mode of ['both', 'unbatched', 'batched']) {
  const result = runNode([...cli, '--mode', mode], 'owned VFS CLI run', process.cwd(), env,
    { stdio: 'pipe', timeoutMs: 5000 });
  const report = JSON.parse(result.stdout);
  assert.equal(path.dirname(report.baseDir), await fs.realpath(parent));
  assert.notEqual(report.baseDir, parent);
  await assert.rejects(fs.stat(report.baseDir), { code: 'ENOENT' });
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'caller-owned');
}
const beforeInvalid = await fs.readdir(parent);
const invalid = runNode([...cli, '--mode', 'invalid'], 'invalid mode', process.cwd(), env,
  { stdio: 'pipe', timeoutMs: 5000, allowFailure: true });
assert.notEqual(invalid.status, 0);
assert.deepEqual(await fs.readdir(parent), beforeInvalid);
const concurrent = await Promise.all([runIoBatching({ ...options, keep: true }), runIoBatching({ ...options, keep: true })]);
assert.notEqual(concurrent[0].baseDir, concurrent[1].baseDir);
for (const result of concurrent) {
  for (const mode of ['batched', 'unbatched']) assert.equal((await fs.readFile(path.join(result.baseDir, mode, 'doc-0.bin'))).length, 8);
}

const write = fs.writeFile, remove = fs.rm;
const primary = Object.assign(new Error('controlled writer failure'), { code: 'ENOSPC' });
let release, held = false, settled = false, removed = false, writes = 0;
const barrier = new Promise(resolve => { release = resolve; });
try {
  fs.writeFile = async (file, ...args) => {
    if (path.basename(file) === 'doc-0.bin') { writes++; throw primary; }
    if (path.basename(file) === 'doc-1.bin') { writes++; held = true; await barrier; }
    return write.call(fs, file, ...args);
  };
  fs.rm = async (file, ...args) => { removed = true; return remove.call(fs, file, ...args); };
  const running = runIoBatching({ ...options, mode: 'batched' });
  const observed = running.then(() => { settled = true; }, error => { settled = true; assert.equal(error, primary); });
  while (!held) await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false); assert.equal(removed, false);
  release(); await observed;
  assert.equal(removed, true); assert.equal(writes, 2, 'no subsequent batch is admitted');
} finally { release?.(); fs.writeFile = write; fs.rm = remove; }

let refusedRoot;
try {
  fs.writeFile = async () => { throw primary; };
  const refusal = new Error('controlled cleanup refusal');
  fs.rm = async file => { refusedRoot = file; throw refusal; };
  await assert.rejects(runIoBatching({ ...options, mode: 'unbatched' }), error => {
    assert.equal(error.cause, primary); assert.equal(error.errors?.includes(refusal), true);
    return true;
  });
  assert.equal(path.dirname(refusedRoot), await fs.realpath(parent));
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'caller-owned');
} finally { fs.writeFile = write; fs.rm = remove; }
console.log('VFS I/O ownership test passed');
