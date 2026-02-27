#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { BloomFilter, encodeBloomFilter } from '../../../src/shared/bloom.js';
import { loadVfsManifestRowByPath } from '../../../src/index/tooling/vfs.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const tempRoot = await makeTempDir('pairofcleats-vfs-bloom-');

try {
  const bloom = new BloomFilter({ bits: 1024, hashes: 3 });
  bloom.add('.poc-vfs/src/present.js');
  const bloomPath = path.join(tempRoot, 'vfs_manifest.vfsbloom.json');
  await fs.writeFile(bloomPath, JSON.stringify(encodeBloomFilter(bloom)), 'utf8');

  const missingManifestPath = path.join(tempRoot, 'missing.jsonl');
  const result = await loadVfsManifestRowByPath({
    manifestPath: missingManifestPath,
    virtualPath: '.poc-vfs/src/absent.js',
    bloomPath,
    allowScan: true
  });

  assert.equal(result, null, 'expected bloom negative lookup to skip manifest scan');
  console.log('VFS bloom negative lookup test passed');
} finally {
  await rmDirRecursive(tempRoot);
}
