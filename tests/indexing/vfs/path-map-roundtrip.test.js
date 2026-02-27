#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildVfsManifestRowsForFile,
  buildVfsHashVirtualPath
} from '../../../src/index/tooling/vfs.js';
import { enqueueVfsManifestArtifacts } from '../../../src/index/build/artifacts/writers/vfs-manifest.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const runWriter = async ({ outDir, mode, rows, hashRouting }) => {
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
    hashRouting,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel
  });

  for (const write of writes) {
    await write.fn();
  }
};

const tempRoot = await makeTempDir('pairofcleats-vfs-map-');
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

  await runWriter({ outDir, mode: 'code', rows, hashRouting: true });

  const mapPath = path.join(outDir, 'vfs_path_map.jsonl');
  const contents = await fs.readFile(mapPath, 'utf8');
  const line = contents.trim();
  assert.ok(line, 'expected vfs_path_map content');
  const entry = JSON.parse(line);
  assert.equal(entry.virtualPath, rows[0].virtualPath);
  const expectedHash = buildVfsHashVirtualPath({
    docHash: rows[0].docHash,
    effectiveExt: rows[0].effectiveExt
  });
  assert.equal(entry.hashVirtualPath, expectedHash);
  assert.equal(entry.containerPath, rows[0].containerPath);
  assert.equal(entry.segmentUid, rows[0].segmentUid);
  assert.equal(entry.segmentStart, rows[0].segmentStart);
  assert.equal(entry.segmentEnd, rows[0].segmentEnd);

  console.log('vfs path map ok');
} finally {
  await rmDirRecursive(tempRoot);
}
