import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { runIoBatching } from '../../../tools/bench/vfs/io-batching-owner.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

const { dir } = await prepareIsolatedTestCacheDir('vfs-io-ownership');
const parent = path.join(dir, 'caller-output');
await fs.mkdir(path.join(parent, 'batched'), { recursive: true });
const sentinel = path.join(parent, 'batched', 'doc-0.bin');
await fs.writeFile(sentinel, 'caller-owned');
await fs.mkdir(path.join(parent, 'unbatched'));
const unbatchedSentinel = path.join(parent, 'unbatched', 'doc-0.bin');
await fs.writeFile(unbatchedSentinel, 'caller-unbatched');
const options = { fileCount: 4, payloadSize: 8, batchSize: 2, outDir: parent };
const env = applyTestEnv({ syncProcess: false, extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const cli = ['tools/bench/vfs/io-batching.js', '--files', '4', '--size', '8', '--batch', '2', '--outDir', parent, '--json'];
for (const [mode, keep] of [['both', false], ['unbatched', false], ['batched', false], ['both', true]]) {
  const result = runNode([...cli, '--mode', mode, ...(keep ? ['--keep'] : [])], 'owned VFS CLI run', process.cwd(), env,
    { stdio: 'pipe', timeoutMs: 5000 });
  const report = JSON.parse(result.stdout);
  assert.equal(path.dirname(report.baseDir), await fs.realpath(parent));
  assert.notEqual(report.baseDir, parent);
  if (keep) {
    for (const arm of ['batched', 'unbatched']) assert.equal((await fs.readFile(path.join(report.baseDir, arm, 'doc-0.bin'))).length, 8);
    await fs.rm(report.baseDir, { recursive: true });
  } else await assert.rejects(fs.stat(report.baseDir), { code: 'ENOENT' });
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'caller-owned');
  assert.equal(await fs.readFile(unbatchedSentinel, 'utf8'), 'caller-unbatched');
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

const mkdir = fs.mkdir;
for (const boundary of ['parent', 'arm']) {
  let deletions = [], admittedRoot;
  const refusal = new Error(`controlled ${boundary} mkdir refusal`);
  try {
    fs.mkdir = async (target, ...args) => {
      if (boundary === 'parent' && target === parent || boundary === 'arm' && path.basename(target) === 'unbatched') {
        if (boundary === 'arm') admittedRoot = path.dirname(target);
        throw refusal;
      }
      return mkdir(target, ...args);
    };
    fs.rm = async (target, ...args) => { deletions.push(target); return remove(target, ...args); };
    await assert.rejects(runIoBatching(options), error => error === refusal);
    assert.deepEqual(deletions, boundary === 'parent' ? [] : [admittedRoot]);
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'caller-owned');
  } finally { fs.mkdir = mkdir; fs.rm = remove; }
}
{
  let replaced = false, deleted = false, ownedRoot, preservedRoot;
  try {
    fs.writeFile = async (target, ...args) => {
      const result = await write(target, ...args);
      if (!replaced) {
        replaced = true; ownedRoot = path.dirname(path.dirname(target)); preservedRoot = `${ownedRoot}-original`;
        await fs.rename(ownedRoot, preservedRoot); await fs.mkdir(ownedRoot);
        await write(path.join(ownedRoot, 'replacement'), 'replacement-owned');
      }
      return result;
    };
    fs.rm = async (...args) => { deleted = true; return remove(...args); };
    await assert.rejects(runIoBatching({ ...options, fileCount: 1, mode: 'unbatched' }), { code: 'ERR_PERSISTENCE_DIRECTORY_CHANGED' });
    assert.equal(deleted, false);
    assert.equal(await fs.readFile(path.join(ownedRoot, 'replacement'), 'utf8'), 'replacement-owned');
    assert.equal((await fs.readFile(path.join(preservedRoot, 'unbatched', 'doc-0.bin'))).length, 8);
  } finally { fs.writeFile = write; fs.rm = remove; }
}
{
  // Hold the actual CLI's first admitted write, then terminate that exact child.
  // Cancellation may retain its disposable run; it never owns the parent.
  const childSource = `import fs from 'node:fs/promises';
    import path from 'node:path';
    const write = fs.writeFile;
    fs.writeFile = async (target, ...args) => {
      if (path.basename(target) === 'doc-0.bin') {
        process.stdout.write('OWNED_WRITE_HELD\\n');
        await new Promise(() => {});
      }
      return write(target, ...args);
    };
    setInterval(() => {}, 1000);
    process.argv = ${JSON.stringify([process.execPath, ...cli])};
    await import(${JSON.stringify(pathToFileURL(path.resolve(cli[0])).href)});`;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', childSource], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const exited = once(child, 'exit');
  let timer, output = '', errors = '';
  child.stderr.on('data', data => { errors += data; });
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`CLI write did not reach its hold boundary: ${errors}`)), 5000);
      child.once('error', reject);
      child.stdout.on('data', data => { output += data; if (output.includes('OWNED_WRITE_HELD')) resolve(); });
      exited.then(() => reject(new Error(`CLI exited before its hold boundary: ${errors}`)), reject);
    });
    child.kill('SIGTERM'); await exited;
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'caller-owned');
    assert.equal(await fs.readFile(unbatchedSentinel, 'utf8'), 'caller-unbatched');
  } finally { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await exited; } }
}
await fs.rm(dir, { recursive: true });
console.log('VFS I/O ownership test passed');
