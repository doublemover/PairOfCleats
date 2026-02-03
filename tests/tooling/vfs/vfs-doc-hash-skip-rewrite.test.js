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

  await ensureVfsDiskDocument({ baseDir: tempRoot, virtualPath, text, docHash });
  const absPath = resolveVfsDiskPath({ baseDir: tempRoot, virtualPath });

  await fs.writeFile(absPath, 'SENTINEL', 'utf8');
  await ensureVfsDiskDocument({ baseDir: tempRoot, virtualPath, text, docHash });

  const content = await fs.readFile(absPath, 'utf8');
  assert.equal(content, 'SENTINEL', 'expected docHash cache to skip rewrite');

  console.log('VFS doc hash skip rewrite test passed');
} finally {
  await rmDirRecursive(tempRoot);
}
