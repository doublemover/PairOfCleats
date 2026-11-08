import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteText, atomicWriteTextSync } from '../../../src/shared/io/atomic-write.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
const root = await makeTempDir('atomic-sibling-staging-');
const originalRename = fs.rename;
try {
  const parent = path.join(root, ...Array.from({ length: 8 }, (_, i) => `segment-${i}-` + 'x'.repeat(24)));
  await fs.mkdir(parent, { recursive: true });
  const target = path.join(parent, 'a'.repeat(230) + '.json');
  let observed = 0;
  fs.rename = async function(from, to, ...args) {
    if (path.resolve(to) === target) {
      observed++;
      assert.equal(path.dirname(from), parent, 'actual Node atomic publication retains its admitted parent for deep paths');
      assert.ok(Buffer.byteLength(path.basename(from)) < 255);
    }
    return originalRename.call(this, from, to, ...args);
  };
  await atomicWriteText(target, 'first immutable bytes');
  assert.equal(observed, 1);
  assert.equal(await fs.readFile(target, 'utf8'), 'first immutable bytes');
  atomicWriteTextSync(target, 'synchronous replacement');
  assert.equal(await fs.readFile(target, 'utf8'), 'synchronous replacement');
  assert.deepEqual(await fs.readdir(parent), [path.basename(target)], 'no ancestor or sibling staging file is left behind');
} finally { fs.rename = originalRename; await rmDirRecursive(root); }
console.log('Deep and long-component Node atomic writes publish through owned sibling staging.');
