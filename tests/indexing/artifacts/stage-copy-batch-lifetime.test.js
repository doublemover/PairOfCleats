import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { copyStageMembers } from '../../../src/index/build/stage-output.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const root = await makeTempDir('stage-copy-batch-lifetime-');
const sourceRoot = path.join(root, 'source'), targetRoot = path.join(root, 'target');
const originalOpen = fs.open, heldStarted = gate(), badClosed = gate(), release = gate();
let copying;
try {
  await fs.mkdir(sourceRoot); await fs.mkdir(targetRoot);
  const names = ['bad', 'bad-two', 'held', 'held-three', 'never-admitted'];
  const bytes = Buffer.from('owned immutable fixture bytes');
  const hash = createHash('sha256').update(bytes).digest('hex');
  for (const name of names) await fs.writeFile(path.join(sourceRoot, name), bytes);
  fs.open = async function(filename, ...args) {
    const handle = await originalOpen.call(this, filename, ...args);
    const name = path.basename(filename);
    if (path.dirname(filename) !== sourceRoot) return handle;
    const read = handle.read, close = handle.close;
    handle.read = async function(...readArgs) {
      if (name.startsWith('bad')) await heldStarted.promise;
      else if (name.startsWith('held')) { heldStarted.resolve(); await release.promise; }
      return read.apply(this, readArgs);
    };
    handle.close = async function(...closeArgs) {
      const result = await close.apply(this, closeArgs);
      if (name === 'bad') badClosed.resolve();
      return result;
    };
    return handle;
  };
  let settled = false;
  copying = copyStageMembers({ sourceRoot, targetRoot, assertOwned() {}, inventory: names.map(name => ({
    path: name, bytes: bytes.length, hash: name.startsWith('bad') ? '0'.repeat(64) : hash })) });
  copying.then(() => { settled = true; }, () => { settled = true; });
  await badClosed.promise;
  assert.equal(settled, false, 'a failed source cannot expose batch failure while another original read remains live');
  release.resolve();
  await assert.rejects(copying, error => error instanceof AggregateError && error.errors.length === 2
    && error.cause === error.errors[0]
    && error.errors.every(failure => /Sealed mode member content changed during copy/.test(failure.message)),
  'all failed original owners remain visible after the drain');
  assert.deepEqual(await fs.readFile(path.join(targetRoot, 'held')), bytes, 'launched atomic writes settle before rejection');
  await assert.rejects(fs.stat(path.join(targetRoot, 'bad')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(targetRoot, 'never-admitted')), { code: 'ENOENT' });
} finally {
  release.resolve(); if (copying) await copying.catch(() => {});
  fs.open = originalOpen; await rmDirRecursive(root);
}
console.log('Stage copy failure drains original descriptors/writers and stops subsequent admission.');
