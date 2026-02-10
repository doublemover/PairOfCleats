#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveVfsDiskPath } from '../../../src/index/tooling/vfs.js';
import { isPathUnderDir } from '../../../src/shared/path-normalize.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-vfs-traversal-deny-'));
applyTestEnv({ cacheRoot: tempRoot });

const resolved = resolveVfsDiskPath({
  baseDir: tempRoot,
  virtualPath: '.poc-vfs/src/main.js'
});
assert.equal(isPathUnderDir(tempRoot, resolved), true, 'safe path should stay contained');

const denyCases = [
  '../outside.js',
  '..\\outside.js',
  'src/../outside.js',
  'src\\..\\outside.js',
  '/tmp/absolute.js',
  'C:\\absolute\\windows.js'
];
for (const virtualPath of denyCases) {
  assert.throws(
    () => resolveVfsDiskPath({ baseDir: tempRoot, virtualPath }),
    /must not escape the baseDir|must be relative|outside baseDir/i,
    `expected traversal deny for: ${virtualPath}`
  );
}

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('vfs path traversal deny test passed');
