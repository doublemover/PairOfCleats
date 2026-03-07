#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createVfsManifestCollector } from '../../../src/index/build/vfs-manifest-collector.js';
import { enqueueVfsManifestArtifacts } from '../../../src/index/build/artifacts/writers/vfs-manifest.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const tempRoot = await makeTempDir('pairofcleats-vfs-cleanup-');
const outDir = path.join(tempRoot, 'out');
await fs.mkdir(outDir, { recursive: true });

const baseRow = {
  schemaVersion: '1.0.0',
  virtualPath: '.poc-vfs/docs/guide.md#seg:segu:v1:abc.ts',
  docHash: 'xxh64:deadbeef',
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
  const collector = createVfsManifestCollector({
    buildRoot: tempRoot,
    maxBufferRows: 1,
    log: () => {}
  });
  await collector.appendRows([baseRow, { ...baseRow, segmentUid: 'segu:v1:def' }]);

  let threw = false;
  try {
    await enqueueVfsManifestArtifacts({
      outDir,
      mode: 'code',
      rows: collector,
      maxJsonBytes: 64,
      compression: null,
      gzipOptions: null,
      enqueueWrite: () => {},
      addPieceFile: () => {},
      formatArtifactLabel: (value) => value
    });
  } catch (err) {
    threw = true;
  }

  assert.ok(threw, 'expected enqueueVfsManifestArtifacts to throw for oversize row');

  const runsDir = path.join(tempRoot, 'vfs_manifest.runs');
  let exists = true;
  try {
    await fs.stat(runsDir);
  } catch {
    exists = false;
  }
  assert.equal(exists, false, 'expected runs directory to be cleaned up');

  console.log('VFS collector cleanup test passed');
} finally {
  await rmDirRecursive(tempRoot);
}
