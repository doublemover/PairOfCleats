#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';
import { updateBundlesWithChunks, writeIncrementalBundle } from '../../../src/index/build/incremental.js';
import { readBundleFile, resolveBundleFormatFromName } from '../../../src/shared/bundle-io.js';

applyTestEnv({
  testing: '1',
  extraEnv: {
    PAIROFCLEATS_INCREMENTAL_BUNDLE_UPDATE_CONCURRENCY: '1'
  }
});

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'incremental-crossfile-bundle-metav2-rewrite');
const bundleDir = path.join(tempRoot, 'incremental', 'code', 'files');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(bundleDir, { recursive: true });

const relKey = 'src/meta-target.swift';
const fileStat = { mtimeMs: 1700000000000, size: 321 };
const chunkBase = {
  file: relKey,
  id: 0,
  chunkId: 'chunk:0',
  text: 'stable body'
};
const oldMetaV2 = {
  chunkId: 'chunk:0',
  file: relKey,
  range: { start: 1, end: 3 },
  lang: 'swift',
  ext: '.swift',
  relations: {
    calls: [{ targetChunkId: 'chunk:old' }]
  }
};
const nextMetaV2 = {
  chunkId: 'chunk:0',
  file: relKey,
  range: { start: 1, end: 3 },
  lang: 'swift',
  ext: '.swift',
  relations: {
    calls: [{ targetChunkId: 'chunk:new' }]
  }
};

const entry = await writeIncrementalBundle({
  enabled: true,
  bundleDir,
  relKey,
  fileStat,
  fileHash: 'hash:meta',
  fileChunks: [{ ...chunkBase, metaV2: oldMetaV2 }],
  fileRelations: { imports: ['./dep.swift'] },
  vfsManifestRows: [{ virtualPath: '/vfs/src/meta-target.swift', languageId: 'swift' }],
  bundleFormat: 'json'
});
assert.ok(entry, 'expected initial bundle write');

const manifest = {
  bundleFormat: 'json',
  files: {
    [relKey]: entry
  }
};

const logs = [];
await updateBundlesWithChunks({
  enabled: true,
  manifest,
  bundleDir,
  bundleFormat: 'json',
  chunks: [{ ...chunkBase, metaV2: nextMetaV2 }],
  fileRelations: new Map([[relKey, { imports: ['./dep.swift'] }]]),
  existingVfsManifestRowsByFile: new Map([[
    relKey,
    [{ virtualPath: '/vfs/src/meta-target.swift', languageId: 'swift' }]
  ]]),
  log: (line) => logs.push(String(line || ''))
});

assert.ok(
  logs.some((line) => line.includes('updated 1 incremental bundle(s)')),
  'expected metaV2-only change to force bundle rewrite'
);
assert.ok(
  !logs.some((line) => line.includes('reused 1')),
  'did not expect bundle reuse when metaV2 changed'
);

const loaded = await readBundleFile(path.join(bundleDir, entry.bundle), {
  format: resolveBundleFormatFromName(entry.bundle, 'json')
});
assert.equal(loaded?.ok, true, 'expected rewritten bundle to load');
const relations = loaded?.bundle?.chunks?.[0]?.metaV2?.relations;
assert.deepEqual(
  relations,
  nextMetaV2.relations,
  'expected rewritten bundle to persist updated metaV2 relations'
);

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('incremental cross-file bundle metaV2 rewrite test passed');
