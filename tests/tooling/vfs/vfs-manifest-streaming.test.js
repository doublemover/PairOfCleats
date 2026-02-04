#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { loadJsonArrayArtifact } from '../../../src/shared/artifact-io.js';
import {
  buildVfsManifestRowsForFile,
  compareVfsManifestRows
} from '../../../src/index/tooling/vfs.js';
import { enqueueVfsManifestArtifacts } from '../../../src/index/build/artifacts/writers/vfs-manifest.js';
import { createVfsManifestCollector } from '../../../src/index/build/vfs-manifest-collector.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const runWriter = async ({ outDir, mode, rows, maxJsonBytes }) => {
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
    maxJsonBytes,
    compression: null,
    gzipOptions: null,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel
  });

  for (const write of writes) {
    await write.fn();
  }
};

const tempRoot = await makeTempDir('pairofcleats-vfs-streaming-');
const outDir = path.join(tempRoot, 'out');
await fs.mkdir(outDir, { recursive: true });

try {
  const fileText = 'console.log(1);\n';

  const rowsA = await buildVfsManifestRowsForFile({
    chunks: [
      {
        file: 'b.md',
        lang: 'javascript',
        segment: {
          segmentUid: 'segu:v1:b',
          segmentId: 'seg-b',
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
    containerPath: 'b.md',
    containerExt: '.md',
    containerLanguageId: 'markdown'
  });

  const rowsB = await buildVfsManifestRowsForFile({
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

  const inputRows = [...rowsA, ...rowsB].reverse();
  const expected = [...rowsA, ...rowsB].sort(compareVfsManifestRows);

  const collector = createVfsManifestCollector({
    buildRoot: tempRoot,
    maxBufferBytes: 16,
    maxBufferRows: 1
  });
  await collector.appendRows(inputRows);
  assert.ok(collector.stats.runsSpilled >= 1, 'expected collector to spill runs');

  const jsonlLineBytes = expected.map((row) => Buffer.byteLength(`${JSON.stringify(row)}\n`));
  const maxLineBytes = Math.max(...jsonlLineBytes);
  const totalBytes = jsonlLineBytes.reduce((sum, bytes) => sum + bytes, 0);
  assert.ok(totalBytes > maxLineBytes + 1, 'fixture should be large enough to force sharding');

  await runWriter({ outDir, mode: 'code', rows: collector, maxJsonBytes: maxLineBytes + 1 });
  const loaded = await loadJsonArrayArtifact(outDir, 'vfs_manifest', { strict: false });

  assert.deepStrictEqual(loaded, expected, 'streamed vfs_manifest should preserve global ordering');
  await fs.stat(path.join(outDir, 'vfs_manifest.meta.json'));
  await fs.stat(path.join(outDir, 'vfs_manifest.parts'));

  console.log('VFS manifest streaming test passed');
} finally {
  await rmDirRecursive(tempRoot);
}
