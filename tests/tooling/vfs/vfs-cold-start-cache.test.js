#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { checksumString } from '../../../src/shared/hash.js';
import { buildIndexSignature } from '../../../src/retrieval/index-cache.js';
import { computeVfsManifestHash, createVfsColdStartCache } from '../../../src/index/tooling/vfs.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const tempRoot = await makeTempDir('pairofcleats-vfs-cold-start-');
const indexDir = path.join(tempRoot, 'index');

try {
  await fs.mkdir(indexDir, { recursive: true });
  const text = 'console.log("cold-start");\n';
  const hash = await checksumString(text);
  const docHash = `xxh64:${hash.value}`;
  const virtualPath = '.poc-vfs/src/app.js';
  const row = {
    schemaVersion: '1.0.0',
    virtualPath,
    docHash,
    containerPath: 'src/app.js',
    containerExt: '.js',
    containerLanguageId: 'javascript',
    languageId: 'javascript',
    effectiveExt: '.js',
    segmentUid: null,
    segmentStart: 0,
    segmentEnd: text.length,
    lineStart: 1,
    lineEnd: 1
  };
  await fs.writeFile(path.join(indexDir, 'vfs_manifest.jsonl'), `${JSON.stringify(row)}\n`, 'utf8');

  const diskPath = path.join(tempRoot, 'vfs-docs', 'src', 'app.js');
  await fs.mkdir(path.dirname(diskPath), { recursive: true });
  await fs.writeFile(diskPath, text, 'utf8');

  const manifestHash = await computeVfsManifestHash({ indexDir });
  const indexSignature = buildIndexSignature(indexDir);
  assert.ok(manifestHash, 'expected manifest hash to be computed');
  assert.ok(indexSignature, 'expected index signature to be computed');

  const cacheConfig = { enabled: true, maxBytes: 1024 * 1024, maxAgeDays: 1, cacheRoot: tempRoot };
  const cache = await createVfsColdStartCache({
    cacheRoot: tempRoot,
    indexSignature,
    manifestHash,
    config: cacheConfig
  });
  cache.set({
    virtualPath,
    docHash,
    diskPath,
    sizeBytes: Buffer.byteLength(text, 'utf8')
  });
  await cache.flush();

  const loaded = await createVfsColdStartCache({
    cacheRoot: tempRoot,
    indexSignature,
    manifestHash,
    config: cacheConfig
  });
  const hit = loaded.get({ virtualPath, docHash });
  assert.equal(hit, diskPath, 'expected cold-start cache hit to return disk path');

  const miss = await createVfsColdStartCache({
    cacheRoot: tempRoot,
    indexSignature: 'different',
    manifestHash,
    config: cacheConfig
  });
  assert.equal(miss.get({ virtualPath, docHash }), null, 'expected signature mismatch to skip cache');

  console.log('VFS cold-start cache test passed');
} finally {
  await rmDirRecursive(tempRoot);
}
