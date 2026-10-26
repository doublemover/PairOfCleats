#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { checksumString } from '../../../src/shared/hash.js';
import { ensureVfsDiskDocument, resolveVfsDiskPath } from '../../../src/index/tooling/vfs.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const tempRoot = await makeTempDir('pairofcleats-vfs-doc-hash-');

try {
  const virtualPath = '.poc-vfs/src/app.js#seg:segu:v1:abc.js';
  const text = 'console.log("hello");\n';
  const hash = await checksumString(text);
  const docHash = `xxh64:${hash.value}`;

  const original = await ensureVfsDiskDocument({ baseDir: tempRoot, virtualPath, text, docHash });
  const absPath = resolveVfsDiskPath({ baseDir: tempRoot, virtualPath });
  const before = await fs.stat(absPath, { bigint: true });
  const unchanged = await ensureVfsDiskDocument({ baseDir: tempRoot, virtualPath, text, docHash });
  const after = await fs.stat(absPath, { bigint: true });
  assert.equal(unchanged.cacheHit, true); assert.equal(unchanged.materialization.verificationBytes, 0);
  assert.equal(unchanged.materialization.sha256, original.materialization.sha256);
  assert.equal(after.ino, before.ino); assert.equal(after.mtimeNs, before.mtimeNs, 'unchanged verified bytes are not rewritten');

  await fs.writeFile(absPath, 'SENTINEL', 'utf8');
  await ensureVfsDiskDocument({ baseDir: tempRoot, virtualPath, text, docHash });

  const content = await fs.readFile(absPath, 'utf8');
  assert.equal(content, text, 'a remembered docHash cannot authorize overwritten bytes');

  await fs.writeFile(absPath, 'STALE_WITHOUT_HASH', 'utf8');
  await ensureVfsDiskDocument({ baseDir: tempRoot, virtualPath, text, docHash: null });
  const rewritten = await fs.readFile(absPath, 'utf8');
  assert.equal(rewritten, text, 'expected missing docHash to force rewrite and prevent stale cache hits');

  console.log('VFS doc hash skip rewrite test passed');
} finally {
  await rmDirRecursive(tempRoot);
}
