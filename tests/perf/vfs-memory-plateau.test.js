#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createVfsColdStartCache } from '../../src/index/tooling/vfs.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { makeTempDir, rmDirRecursive } from '../helpers/temp.js';

applyTestEnv({ testing: '1' });

const tempRoot = await makeTempDir('pairofcleats-vfs-mem-');
const cacheRoot = tempRoot;
const indexSignature = 'bench-index-signature';
const manifestHash = 'xxh64:bench-manifest';
const maxBytes = 800;
const maxAgeDays = 1;

const baseDir = path.join(cacheRoot, 'vfs-cold-start');
const metaPath = path.join(baseDir, 'vfs_cold_start.meta.json');
const dataPath = path.join(baseDir, 'vfs_cold_start.jsonl');

const writeJsonLines = async (filePath, entries) => {
  const lines = entries.map((entry) => `${JSON.stringify(entry)}\n`).join('');
  await fs.writeFile(filePath, lines, 'utf8');
};

try {
  await fs.mkdir(baseDir, { recursive: true });

  const now = Date.now();
  const oldIso = new Date(now - 2 * 86400000).toISOString();
  const recentIso = (offsetMs) => new Date(now - offsetMs).toISOString();

  const entries = [];
  for (let i = 0; i < 10; i += 1) {
    const virtualPath = `.poc-vfs/src/file-${i}.js`;
    const docHash = `xxh64:${i.toString(16).padStart(16, '0')}`;
    const diskPath = path.join(tempRoot, 'vfs-docs', 'src', `file-${i}.js`);
    await fs.mkdir(path.dirname(diskPath), { recursive: true });
    await fs.writeFile(diskPath, `console.log(${i});\n`, 'utf8');
    entries.push({
      schemaVersion: '1.0.0',
      virtualPath,
      docHash,
      diskPath,
      sizeBytes: 250,
      updatedAt: i < 5 ? oldIso : recentIso(i * 1000)
    });
  }

  await writeJsonLines(dataPath, entries);
  await fs.writeFile(
    metaPath,
    `${JSON.stringify({
      schemaVersion: '1.0.0',
      indexSignature,
      manifestHash,
      createdAt: new Date().toISOString(),
      entries: entries.length,
      bytes: entries.reduce((sum, entry) => sum + (entry.sizeBytes || 0), 0)
    })}\n`,
    'utf8'
  );

  const loadCache = async () => (
    createVfsColdStartCache({
      cacheRoot,
      indexSignature,
      manifestHash,
      config: {
        enabled: true,
        maxBytes,
        maxAgeDays,
        cacheRoot
      }
    })
  );

  const cache = await loadCache();
  assert.ok(cache, 'expected cold-start cache to be enabled in test mode');
  assert.ok(cache.size() > 0, 'expected some cache entries to load');
  assert.ok(cache.size() <= 3, 'expected maxBytes compaction to keep entries bounded');

  // Old entries should be pruned by maxAgeDays.
  const oldEntry = entries[0];
  assert.equal(cache.get({ virtualPath: oldEntry.virtualPath, docHash: oldEntry.docHash }), null, 'expected old entry to be pruned');

  cache.set({
    virtualPath: entries[9].virtualPath,
    docHash: entries[9].docHash,
    diskPath: entries[9].diskPath,
    sizeBytes: entries[9].sizeBytes
  });
  await cache.flush();

  const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
  assert.equal(meta.indexSignature, indexSignature);
  assert.equal(meta.manifestHash, manifestHash);
  assert.ok(Number.isFinite(meta.bytes) && meta.bytes <= maxBytes, 'expected meta.bytes to respect maxBytes');
  assert.ok(Number.isFinite(meta.entries) && meta.entries <= 3, 'expected meta.entries to remain bounded');

  const dataLines = (await fs.readFile(dataPath, 'utf8')).trim().split(/\r?\n/).filter(Boolean);
  assert.equal(dataLines.length, meta.entries, 'expected jsonl line count to match meta.entries');

  // Plateau: repeated load/set/flush loops must keep entry count/bytes bounded.
  for (let i = 0; i < 25; i += 1) {
    const loaded = await loadCache();
    assert.ok(loaded.size() <= 3, 'expected cache size to remain bounded across reloads');
    const pick = entries[5 + (i % 5)];
    loaded.set({
      virtualPath: pick.virtualPath,
      docHash: pick.docHash,
      diskPath: pick.diskPath,
      sizeBytes: pick.sizeBytes
    });
    await loaded.flush();
    const loopMeta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
    assert.ok(loopMeta.bytes <= maxBytes, 'expected meta.bytes to remain bounded across flushes');
    assert.ok(loopMeta.entries <= 3, 'expected meta.entries to remain bounded across flushes');
  }

  console.log('VFS memory plateau test passed');
} finally {
  await rmDirRecursive(tempRoot);
}

