import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { copyUnpublishedStageMembers } from '../../../src/index/build/stage-output.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';

const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'poc-unpublished-copy-')));
const originalOpen = fs.open;
const bytes = Buffer.from('independent snapshot bytes: \u03bb\n');
const part = name => ({ path: name, bytes: bytes.length, hash: createHash('sha256').update(bytes).digest('hex') });
const roots = async name => {
  const sourceRoot = path.join(root, name + '-source'), targetRoot = path.join(root, name + '-target');
  await fs.mkdir(sourceRoot); await fs.mkdir(targetRoot);
  return { sourceRoot, targetRoot, assertOwned() {} };
};
const pendingSessions = [];
let allowClose = false;
const captureSessions = error => {
  const seen = new Set();
  const visit = value => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    visit(Object.getOwnPropertyDescriptor(value, 'cause')?.value);
    const errors = Object.getOwnPropertyDescriptor(value, 'errors')?.value;
    if (Array.isArray(errors)) for (const nested of errors) visit(nested);
    const session = getContainedFileSession(value);
    if (session && !pendingSessions.includes(session)) pendingSessions.push(session);
  };
  visit(error);
};
try {
  {
    const options = await roots('ordinary'), inventory = [part('nested/data'), { path: 'empty', bytes: 0,
      hash: createHash('sha256').update('').digest('hex') }];
    await fs.mkdir(path.join(options.sourceRoot, 'nested'));
    await fs.writeFile(path.join(options.sourceRoot, 'nested/data'), bytes);
    await fs.writeFile(path.join(options.sourceRoot, 'empty'), '');
    fs.open = async function(filename, ...args) {
      const handle = await originalOpen.call(this, filename, ...args);
      if (filename === path.join(options.targetRoot, 'nested/data')) {
        const write = handle.write;
        handle.write = function(buffer, offset, length, position) {
          return write.call(this, buffer, offset, Math.min(3, length), position);
        };
      }
      return handle;
    };
    await copyUnpublishedStageMembers({ ...options, inventory });
    fs.open = originalOpen;
    assert.deepEqual(await fs.readFile(path.join(options.targetRoot, 'nested/data')), bytes);
    assert.equal((await fs.stat(path.join(options.targetRoot, 'nested/data'))).nlink, 1);
    assert.equal((await fs.stat(path.join(options.targetRoot, 'empty'))).size, 0);
    await assert.rejects(copyUnpublishedStageMembers({ ...options, inventory }), { code: 'EEXIST' });
    assert.deepEqual(await fs.readFile(path.join(options.targetRoot, 'nested/data')), bytes, 'exclusive collision cannot overwrite old bytes');
    await fs.writeFile(path.join(options.sourceRoot, 'nested/data'), 'changed source');
    assert.deepEqual(await fs.readFile(path.join(options.targetRoot, 'nested/data')), bytes, 'the snapshot is an independent copy');
  }
  {
    const options = await roots('drain'), names = ['bad', 'held-one', 'held-two', 'held-three', 'never-admitted'];
    for (const name of names) await fs.writeFile(path.join(options.sourceRoot, name), bytes);
    const held = gate(), badClosed = gate(), release = gate();
    let heldReads = 0, settled = false;
    const opened = new Set();
    fs.open = async function(filename, ...args) {
      const handle = await originalOpen.call(this, filename, ...args);
      if (path.dirname(filename) !== options.sourceRoot) return handle;
      const name = path.basename(filename), read = handle.read, close = handle.close;
      opened.add(name);
      handle.read = async function(...readArgs) {
        if (name === 'bad') await held.promise;
        else { if (++heldReads === 3) held.resolve(); await release.promise; }
        return read.apply(this, readArgs);
      };
      handle.close = async function(...closeArgs) {
        const result = await close.apply(this, closeArgs);
        if (name === 'bad') badClosed.resolve();
        return result;
      };
      return handle;
    };
    const result = copyUnpublishedStageMembers({ ...options, inventory: names.map(name => ({ ...part(name),
      ...(name === 'bad' ? { hash: '0'.repeat(64) } : {}) })) }).then(
      () => { settled = true; return null; }, error => { settled = true; return error; });
    try {
      await badClosed.promise; await new Promise(resolve => setImmediate(resolve));
      assert.equal(settled, false, 'a failed hash cannot return while original source reads remain live');
    } finally { release.resolve(); }
    assert.match((await result).message, /content changed during copy/);
    assert.equal(opened.has('never-admitted'), false);
    for (const name of names.slice(1, 4)) assert.deepEqual(await fs.readFile(path.join(options.targetRoot, name)), bytes);
    await assert.rejects(fs.stat(path.join(options.targetRoot, 'stage-completion.json')), { code: 'ENOENT' });
    fs.open = originalOpen;
  }
  {
    const options = await roots('close'), inventory = [part('data')];
    await fs.writeFile(path.join(options.sourceRoot, 'data'), bytes);
    const closeFailure = Object.freeze(new Error('controlled original target close failure'));
    let closes = 0;
    fs.open = async function(filename, ...args) {
      const handle = await originalOpen.call(this, filename, ...args);
      if (filename === path.join(options.targetRoot, 'data')) {
        const close = handle.close;
        handle.close = function(...closeArgs) { closes++; if (!allowClose) throw closeFailure; return close.apply(this, closeArgs); };
      }
      return handle;
    };
    await assert.rejects(copyUnpublishedStageMembers({ ...options, inventory }), error => {
      captureSessions(error);
      return pendingSessions.length === 2 && pendingSessions.every(session => session.isSettled() === false);
    });
    assert.equal(closes, 1, 'publication does not retry an uncertain native close');
    assert.deepEqual(await fs.readFile(path.join(options.targetRoot, 'data')), bytes, 'unsealed evidence is retained without pathname cleanup');
    allowClose = true;
    for (const session of pendingSessions) await session.releaseAfterClose();
    assert.ok(pendingSessions.every(session => session.isSettled())); assert.equal(closes, 2);
    fs.open = originalOpen;
  }
} finally {
  allowClose = true;
  for (const session of pendingSessions) if (!session.isSettled()) await session.releaseAfterClose();
  fs.open = originalOpen;
  assert.equal(await fs.realpath(root), root);
  assert.ok(path.basename(root).startsWith('poc-unpublished-copy-'));
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Unpublished snapshot copies retain exclusive bytes, partial writes, original read draining and failed-close ownership.');
