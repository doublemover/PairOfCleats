#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

import { enqueueVfsManifestArtifacts } from '../../../src/index/build/artifacts/writers/vfs-manifest.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const tempRoot = await makeTempDir('pairofcleats-vfs-atomic-swap-');
const outDir = path.join(tempRoot, 'out');
await fs.mkdir(outDir, { recursive: true });

const manifestPath = path.join(outDir, 'vfs_manifest.jsonl');
const indexPath = path.join(outDir, 'vfs_manifest.vfsidx');
const bloomPath = path.join(outDir, 'vfs_manifest.vfsbloom.json');

const baseRow = {
  schemaVersion: '1.0.0',
  virtualPath: '.poc-vfs/docs/guide.md#seg:segu:v1:abc.ts',
  docHash: 'xxh64:deadbeefdeadbeef',
  containerPath: 'docs/guide.md',
  containerExt: '.md',
  containerLanguageId: 'markdown',
  languageId: 'typescript',
  effectiveExt: '.ts',
  segmentUid: 'segu:v1:abc',
  segmentId: 'seg-1',
  segmentStart: 0,
  segmentEnd: 10,
  lineStart: 1,
  lineEnd: 1
};

try {
  // Seed an existing artifact set. The writer must not delete these until a replacement is fully written.
  await fs.writeFile(manifestPath, `${JSON.stringify(baseRow)}\n`);
  await fs.writeFile(indexPath, `${JSON.stringify({ schemaVersion: '1.0.0', virtualPath: baseRow.virtualPath, offset: 0, bytes: 0 })}\n`);
  await fs.writeFile(bloomPath, JSON.stringify({ schemaVersion: '1.0.0', bits: '', hashCount: 1, entries: 1 }) + '\n');

  let threw = false;
  try {
    await enqueueVfsManifestArtifacts({
      outDir,
      mode: 'code',
      rows: [baseRow],
      maxJsonBytes: 1024 * 1024,
      compression: 'gzip',
      gzipOptions: null,
      hashRouting: false,
      enqueueWrite: () => {
        throw new Error('Injected enqueueWrite failure');
      },
      addPieceFile: () => {},
      formatArtifactLabel: (value) => value
    });
  } catch (err) {
    threw = true;
  }
  assert.ok(threw, 'expected enqueueVfsManifestArtifacts to throw');

  assert.equal(fsSync.existsSync(manifestPath), true, 'expected previous vfs_manifest.jsonl to remain');
  assert.equal(fsSync.existsSync(indexPath), true, 'expected previous vfs_manifest.vfsidx to remain');
  assert.equal(fsSync.existsSync(bloomPath), true, 'expected previous vfs_manifest.vfsbloom.json to remain');

  console.log('VFS compaction atomic swap test passed');
} finally {
  await rmDirRecursive(tempRoot);
}

