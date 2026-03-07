#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createVfsColdStartCache } from '../../../src/index/tooling/vfs/cold-start.js';
import {
  VFS_COLD_START_DATA,
  VFS_COLD_START_DIR,
  VFS_COLD_START_META
} from '../../../src/index/tooling/vfs/constants.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const tempRoot = await makeTempDir('poc-vfs-cold-start-corrupt-');
const coldStartDir = path.join(tempRoot, VFS_COLD_START_DIR);
const metaPath = path.join(coldStartDir, VFS_COLD_START_META);
const dataPath = path.join(coldStartDir, VFS_COLD_START_DATA);

try {
  await fs.mkdir(coldStartDir, { recursive: true });
  await fs.writeFile(metaPath, '{"broken":', 'utf8');
  await fs.writeFile(dataPath, '{not-jsonl}\n', 'utf8');

  const cache = await createVfsColdStartCache({
    cacheRoot: tempRoot,
    indexSignature: 'sig-1',
    manifestHash: 'manifest-1',
    config: {
      enabled: true,
      cacheRoot: tempRoot,
      maxBytes: 1024 * 1024,
      maxAgeDays: 1
    }
  });

  assert.ok(cache, 'expected cold-start cache creation to fail open on corrupt cache files');
  assert.equal(cache.size(), 0, 'expected corrupt cache rows to be dropped');
  assert.equal(
    cache.get({ virtualPath: '.poc-vfs/src/app.js', docHash: 'xxh64:abc' }),
    null,
    'expected empty cache after corrupt metadata/data files'
  );

  console.log('vfs cold-start corrupt cache fail-open test passed');
} finally {
  await rmDirRecursive(tempRoot);
}
