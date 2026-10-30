import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { copyUnpublishedStageMembers, inventoryStageOutput, inventoryStageOutputForCopy } from '../../../src/index/build/stage-output.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';

const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'poc-unpublished-copy-')));
const originalOpen = fs.open, originalLstat = fsSync.lstatSync;
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
    const buildRoot = path.join(root, 'inventory'), sourceRoot = path.join(buildRoot, 'index-code');
    const targetRoot = path.join(root, 'inventory-copy'), rejectedRoot = path.join(root, 'inventory-rejected');
    await fs.mkdir(path.join(sourceRoot, 'pieces'), { recursive: true });
    await fs.mkdir(targetRoot); await fs.mkdir(rejectedRoot);
    const filename = path.join(sourceRoot, 'data'), piece = { path: 'data', bytes: bytes.length,
      name: 'fixture', format: 'binary', count: 1, checksum: 'sha256:' + part('data').hash };
    await fs.writeFile(filename, bytes);
    const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, mode: 'code', buildId: 'closed-copy-fixture', pieces: [piece] };
    const manifestPath = path.join(sourceRoot, 'pieces/manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    let sourceOpens = 0;
    fs.open = async function(file, ...args) { if (file === filename) sourceOpens++; return originalOpen.call(this, file, ...args); };
    const options = { buildRoot, buildId: manifest.buildId, mode: 'code' };
    const ordinary = await inventoryStageOutput(options);
    assert.equal(sourceOpens, 1, 'ordinary reuse/inventory verification reads the actual member');
    sourceOpens = 0;
    const prepared = await inventoryStageOutputForCopy(options);
    assert.equal(sourceOpens, 0, 'a subsequent verified copy need not pre-read the same SHA-256 source');
    assert.deepEqual(prepared.output, ordinary.output); assert.deepEqual(prepared.inventory, ordinary.inventory);
    await copyUnpublishedStageMembers({ sourceRoot, targetRoot, inventory: prepared.inventory, assertOwned() {} });
    assert.equal(sourceOpens, 1, 'the copy verifies the actual original source descriptor');
    piece.checksum = 'sha256:' + '0'.repeat(64);
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    const corrupted = await inventoryStageOutputForCopy(options);
    await assert.rejects(copyUnpublishedStageMembers({ sourceRoot, targetRoot: rejectedRoot,
      inventory: corrupted.inventory, assertOwned() {} }), /content changed during copy/);
    assert.equal((await inventoryStageOutput(options)).inventory[0].hash, part('data').hash,
      'ordinary verification never promotes the corrupt pin into a physical hash');
    fsSync.lstatSync = function(file, ...args) {
      const stat = originalLstat.call(this, file, ...args);
      return file === filename ? new Proxy(stat, {
        get: (value, key) => key === 'isSymbolicLink' ? () => true : Reflect.get(value, key)
      }) : stat;
    };
    sourceOpens = 0;
    const redirected = await inventoryStageOutputForCopy(options);
    await assert.rejects(copyUnpublishedStageMembers({ sourceRoot, targetRoot: rejectedRoot,
      inventory: redirected.inventory, assertOwned() {} }), { code: 'ERR_UNSAFE_FILE_PATH' });
    assert.equal(sourceOpens, 0, 'a manifest digest never grants access to a redirected physical source');
    fsSync.lstatSync = originalLstat;
    fs.open = originalOpen;
  }
  {
    const options = await roots('late-target'), name = 'nested/data';
    await fs.mkdir(path.join(options.sourceRoot, 'nested'));
    await fs.writeFile(path.join(options.sourceRoot, name), bytes);
    const parent = path.join(options.targetRoot, 'nested');
    let denyParent = false, targetOpens = 0, sourceCloses = 0;
    fsSync.lstatSync = function(filename, ...args) {
      const stat = originalLstat.call(this, filename, ...args);
      return denyParent && filename === parent ? new Proxy(stat, {
        get: (value, key) => key === 'isSymbolicLink' ? () => true : Reflect.get(value, key)
      }) : stat;
    };
    fs.open = async function(filename, ...args) {
      if (filename === path.join(options.targetRoot, name)) targetOpens++;
      const handle = await originalOpen.call(this, filename, ...args);
      if (filename === path.join(options.sourceRoot, name)) {
        denyParent = true;
        const close = handle.close;
        handle.close = async function(...closeArgs) { sourceCloses++; return close.apply(this, closeArgs); };
      }
      return handle;
    };
    await assert.rejects(copyUnpublishedStageMembers({ ...options, inventory: [part(name)] }), { code: 'ERR_ARTIFACT_PATH' });
    assert.equal(targetOpens, 0, 'planning never substitutes for physical target admission at actual use');
    assert.equal(sourceCloses, 1, 'a target admission failure closes its actual borrowed source');
    fs.open = originalOpen; fsSync.lstatSync = originalLstat;
  }
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
  fsSync.lstatSync = originalLstat;
  assert.equal(await fs.realpath(root), root);
  assert.ok(path.basename(root).startsWith('poc-unpublished-copy-'));
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Unpublished snapshot copies retain exclusive bytes, partial writes, original read draining and failed-close ownership.');
