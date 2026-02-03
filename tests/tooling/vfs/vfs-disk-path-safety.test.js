#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';

import { resolveVfsDiskPath } from '../../../src/index/tooling/vfs.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const tempRoot = await makeTempDir('pairofcleats-vfs-diskpath-');

try {
  const virtualPath = '.poc-vfs/../C:/evil#seg:segu:v1:abc.ts';
  const resolved = resolveVfsDiskPath({ baseDir: tempRoot, virtualPath });
  const rel = path.relative(tempRoot, resolved);
  const relParts = rel.split(path.sep);

  assert.ok(!rel.startsWith('..'), 'resolved path should remain under baseDir');
  assert.ok(!relParts.includes('..'), 'resolved path should not contain traversal segments');
  assert.ok(rel.includes('%2E%2E') || rel.includes('%2e%2e'), 'dot segments should be encoded');
  assert.ok(rel.includes('%3A'), 'colon should be percent-encoded');

  console.log('VFS disk path safety test passed');
} finally {
  await rmDirRecursive(tempRoot);
}
