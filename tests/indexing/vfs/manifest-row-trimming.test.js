#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { loadJsonArrayArtifact } from '../../../src/shared/artifact-io.js';
import { buildVfsManifestRowsForFile } from '../../../src/index/tooling/vfs.js';
import { enqueueVfsManifestArtifacts } from '../../../src/index/build/artifacts/writers/vfs-manifest.js';
import { writePiecesManifest } from '../../helpers/artifact-io-fixture.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const MAX_ROW_BYTES = 32 * 1024;

const runWriter = async ({ outDir, mode, rows, maxJsonBytes }) => {
  const writes = [];
  const pieceFiles = [];
  const enqueueWrite = (label, fn) => {
    writes.push({ label, fn });
  };
  const addPieceFile = (entry, absPath) => {
    pieceFiles.push({ entry, absPath });
  };
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
  if (pieceFiles.length) {
    const pieces = pieceFiles.map(({ entry, absPath }) => ({
      ...entry,
      path: path.relative(outDir, absPath).replace(/\\/g, '/')
    }));
    await writePiecesManifest(outDir, pieces);
  }
};

const tempRoot = await makeTempDir('pairofcleats-vfs-trim-');
const outDir = path.join(tempRoot, 'out');
await fs.mkdir(outDir, { recursive: true });

try {
  const containerPath = 'docs/trim.md';
  const containerExt = '.md';
  const containerLanguageId = 'markdown';
  const fileText = 'console.log(1);\n';
  const chunks = [
    {
      file: containerPath,
      lang: 'javascript',
      segment: {
        segmentUid: 'segu:v1:trim',
        segmentId: 'seg-trim',
        start: 0,
        end: fileText.length,
        languageId: 'javascript',
        ext: null
      },
      start: 0,
      end: fileText.length
    }
  ];

  const baseRows = await buildVfsManifestRowsForFile({
    chunks,
    fileText,
    containerPath,
    containerExt,
    containerLanguageId
  });
  assert.equal(baseRows.length, 1, 'expected a base vfs manifest row');

  const oversized = {
    ...baseRows[0],
    extensions: { blob: 'x'.repeat(40000) }
  };

  await runWriter({ outDir, mode: 'code', rows: [oversized], maxJsonBytes: 1024 * 1024 });
  const loaded = await loadJsonArrayArtifact(outDir, 'vfs_manifest', { strict: false });

  assert.equal(loaded.length, 1, 'trimmed row should still be emitted');
  assert.equal(loaded[0].segmentId, baseRows[0].segmentId, 'segmentId should be preserved');
  assert.ok(!loaded[0].extensions, 'extensions should be trimmed when oversize');

  const rowBytes = Buffer.byteLength(JSON.stringify(loaded[0]), 'utf8');
  assert.ok(rowBytes <= MAX_ROW_BYTES, 'trimmed row should fit within MAX_ROW_BYTES');

  console.log('VFS manifest row trimming ok');
} finally {
  await rmDirRecursive(tempRoot);
}
