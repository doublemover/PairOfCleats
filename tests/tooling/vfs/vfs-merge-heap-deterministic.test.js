#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createVfsManifestCollector } from '../../../src/index/build/vfs-manifest-collector.js';
import { enqueueVfsManifestArtifacts } from '../../../src/index/build/artifacts/writers/vfs-manifest.js';
import { compareVfsManifestRows } from '../../../src/index/tooling/vfs.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const readJsonl = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
};

const runWriter = async ({ outDir, rows }) => {
  const writes = [];
  const enqueueWrite = (label, fn) => {
    writes.push({ label, fn });
  };
  const addPieceFile = () => {};
  const formatArtifactLabel = (value) => value;

  await enqueueVfsManifestArtifacts({
    outDir,
    mode: 'code',
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

const tempRoot = await makeTempDir('pairofcleats-vfs-merge-heap-');
const outDir = path.join(tempRoot, 'out');
await fs.mkdir(outDir, { recursive: true });

try {
  const rows = [
    {
      schemaVersion: '1.0.0',
      virtualPath: '.poc-vfs/b.ts#seg:seg-b.ts',
      docHash: 'xxh64:bbbbbbbbbbbbbbbb',
      containerPath: 'b.ts',
      containerExt: '.ts',
      containerLanguageId: 'typescript',
      languageId: 'typescript',
      effectiveExt: '.ts',
      segmentUid: 'seg-b',
      segmentId: 'seg-b',
      segmentStart: 10,
      segmentEnd: 20,
      lineStart: 1,
      lineEnd: 2
    },
    {
      schemaVersion: '1.0.0',
      virtualPath: '.poc-vfs/a.ts#seg:seg-a.ts',
      docHash: 'xxh64:aaaaaaaaaaaaaaaa',
      containerPath: 'a.ts',
      containerExt: '.ts',
      containerLanguageId: 'typescript',
      languageId: 'typescript',
      effectiveExt: '.ts',
      segmentUid: 'seg-a',
      segmentId: 'seg-a',
      segmentStart: 0,
      segmentEnd: 5,
      lineStart: 1,
      lineEnd: 1
    },
    {
      schemaVersion: '1.0.0',
      virtualPath: '.poc-vfs/a.ts#seg:seg-c.ts',
      docHash: 'xxh64:cccccccccccccccc',
      containerPath: 'a.ts',
      containerExt: '.ts',
      containerLanguageId: 'typescript',
      languageId: 'typescript',
      effectiveExt: '.ts',
      segmentUid: 'seg-c',
      segmentId: 'seg-c',
      segmentStart: 6,
      segmentEnd: 9,
      lineStart: 2,
      lineEnd: 2
    }
  ];

  const collector = createVfsManifestCollector({
    buildRoot: tempRoot,
    maxBufferRows: 1,
    maxBufferBytes: 1
  });
  await collector.appendRows(rows);

  await runWriter({ outDir, rows: collector });

  const manifestPath = path.join(outDir, 'vfs_manifest.jsonl');
  const written = await readJsonl(manifestPath);
  const expected = rows.slice().sort(compareVfsManifestRows);

  assert.deepStrictEqual(
    written.map((row) => row.virtualPath),
    expected.map((row) => row.virtualPath),
    'Expected heap-merged manifest rows to be deterministically sorted.'
  );

  console.log('vfs merge heap deterministic ok');
} finally {
  await rmDirRecursive(tempRoot);
}
