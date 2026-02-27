#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildVfsManifestRowsForFile,
  loadVfsManifestIndex,
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

const tempRoot = await makeTempDir('pairofcleats-vfs-idx-');
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
  await fs.stat(indexPath);

  const index = await loadVfsManifestIndex({ indexPath });
  assert.equal(index.size, rows.length);

  const row = rows[0];
  const loaded = await loadVfsManifestRowByPath({
    manifestPath,
    index,
    virtualPath: row.virtualPath
  });
  assert.deepStrictEqual(loaded, row);

  console.log('vfs index lookup ok');
} finally {
  await rmDirRecursive(tempRoot);
}
