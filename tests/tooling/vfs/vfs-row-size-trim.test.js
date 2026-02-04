#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { loadJsonArrayArtifact } from '../../../src/shared/artifact-io.js';
import { buildVfsManifestRowsForFile, VFS_MANIFEST_MAX_ROW_BYTES } from '../../../src/index/tooling/vfs.js';
import { enqueueVfsManifestArtifacts } from '../../../src/index/build/artifacts/writers/vfs-manifest.js';
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

const tempRoot = await makeTempDir('pairofcleats-vfs-row-size-');
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
  assert.ok(!loaded[0].extensions, 'extensions should be trimmed when oversize');

  const rowBytes = Buffer.byteLength(JSON.stringify(loaded[0]), 'utf8');
  assert.ok(rowBytes <= VFS_MANIFEST_MAX_ROW_BYTES, 'trimmed row should fit within max bytes');

  const huge = {
    ...baseRows[0],
    containerPath: 'a'.repeat(VFS_MANIFEST_MAX_ROW_BYTES * 2),
    virtualPath: `.poc-vfs/${'a'.repeat(VFS_MANIFEST_MAX_ROW_BYTES * 2)}`
  };

  const dropDir = path.join(tempRoot, 'drop');
  await fs.mkdir(dropDir, { recursive: true });
  await runWriter({ outDir: dropDir, mode: 'code', rows: [huge], maxJsonBytes: 1024 * 1024 });
  let hasManifest = true;
  try {
    await fs.stat(path.join(dropDir, 'vfs_manifest.jsonl'));
  } catch {
    hasManifest = false;
  }
  assert.equal(hasManifest, false, 'oversize row should result in no manifest file');

  console.log('VFS row size trimming test passed');
} finally {
  await rmDirRecursive(tempRoot);
}
