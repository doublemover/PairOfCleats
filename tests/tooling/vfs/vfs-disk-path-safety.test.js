#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';

import { resolveVfsDiskPath } from '../../../src/index/tooling/vfs.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const tempRoot = await makeTempDir('pairofcleats-vfs-diskpath-');

try {
  const virtualPath = '.poc-vfs/../C:/evil#seg:segu:v1:abc.ts';
  assert.throws(
    () => resolveVfsDiskPath({ baseDir: tempRoot, virtualPath }),
    /must not escape the baseDir|must be relative|outside baseDir/i
  );

  const safeResolved = resolveVfsDiskPath({
    baseDir: tempRoot,
    virtualPath: '.poc-vfs/safe/path#seg:segu:v1:abc.ts'
  });
  const rel = path.relative(tempRoot, safeResolved);
  assert.ok(!rel.startsWith('..'), 'safe path should remain under baseDir');

  console.log('VFS disk path safety test passed');
} finally {
  await rmDirRecursive(tempRoot);
}
