#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildVfsManifestRowsForFile,
  loadVfsManifestRowByPath
} from '../../../src/index/tooling/vfs.js';
import { enqueueVfsManifestArtifacts } from '../../../src/index/build/artifacts/writers/vfs-manifest.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const runWriter = async ({ outDir, mode, rows }) => {
  const writes = [];
  const enqueueWrite = (label, fn) => {
    writes.push({ label, fn });
  };
  const addPieceFile = () => {};
  const formatArtifactLabel = (value) => value;

  await enqueueVfsManifestArtifacts({
    outDir,
    mode,
    rows,
    maxJsonBytes: 1000000,
    compression: null,
    gzipOptions: null,
    hashRouting: false,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel
  });

  for (const write of writes) {
    await write.fn();
  }
};

const tempRoot = await makeTempDir('pairofcleats-vfs-idx-negative-');
const outDir = path.join(tempRoot, 'out');
await fs.mkdir(outDir, { recursive: true });

try {
  const fileText = 'console.log(1);\n';
  const rows = await buildVfsManifestRowsForFile({
    chunks: [
      {
        file: 'a.md',
        lang: 'javascript',
        segment: {
          segmentUid: 'segu:v1:a',
          segmentId: 'seg-a',
          start: 0,
          end: fileText.length,
          languageId: 'javascript',
          ext: null
        },
        start: 0,
        end: fileText.length
      }
    ],
    fileText,
    containerPath: 'a.md',
    containerExt: '.md',
    containerLanguageId: 'markdown'
  });

  await runWriter({ outDir, mode: 'code', rows });

  const manifestPath = path.join(outDir, 'vfs_manifest.jsonl');
  const indexPath = path.join(outDir, 'vfs_manifest.vfsidx');
  const bloomPath = path.join(outDir, 'vfs_manifest.vfsbloom.json');

  const missingPath = '.poc-vfs/missing.md#seg:missing';
  const notFound = await loadVfsManifestRowByPath({
    manifestPath,
    indexPath,
    bloomPath,
    virtualPath: missingPath
  });
  assert.equal(notFound, null, 'Expected missing virtualPath to return null with bloom/index.');

  const noIndex = await loadVfsManifestRowByPath({
    manifestPath,
    virtualPath: missingPath,
    allowScan: false
  });
  assert.equal(noIndex, null, 'Expected null without index when allowScan=false.');

  const scanMiss = await loadVfsManifestRowByPath({
    manifestPath,
    virtualPath: missingPath,
    allowScan: true
  });
  assert.equal(scanMiss, null, 'Expected null when scanning for missing virtualPath.');

  console.log('vfs index negative lookup ok');
} finally {
  await rmDirRecursive(tempRoot);
}
