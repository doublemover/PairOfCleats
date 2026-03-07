#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildVfsManifestRowsForFile,
  createVfsManifestOffsetReader,
  loadVfsManifestIndex,
  loadVfsManifestRowByPath,
  readVfsManifestRowsAtOffsets
} from '../../../src/index/tooling/vfs.js';
import { enqueueVfsManifestArtifacts } from '../../../src/index/build/artifacts/writers/vfs-manifest.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

applyTestEnv({ testing: '1' });

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

const tempRoot = await makeTempDir('pairofcleats-vfs-fastpath-telemetry-');
const outDir = path.join(tempRoot, 'out');
await fs.mkdir(outDir, { recursive: true });

try {
  const fileText = 'const a = 1;\nconst b = 2;\n';
  const rows = await buildVfsManifestRowsForFile({
    chunks: [
      {
        file: 'src/a.ts',
        lang: 'typescript',
        segment: {
          segmentUid: 'segu:v1:a',
          segmentId: 'seg-a',
          start: 0,
          end: 12,
          languageId: 'typescript',
          ext: '.ts'
        },
        start: 0,
        end: 12
      },
      {
        file: 'src/a.ts',
        lang: 'typescript',
        segment: {
          segmentUid: 'segu:v1:b',
          segmentId: 'seg-b',
          start: 13,
          end: fileText.length,
          languageId: 'typescript',
          ext: '.ts'
        },
        start: 13,
        end: fileText.length
      }
    ],
    fileText,
    containerPath: 'src/a.ts',
    containerExt: '.ts',
    containerLanguageId: 'typescript'
  });

  await runWriter({ outDir, mode: 'code', rows });

  const manifestPath = path.join(outDir, 'vfs_manifest.jsonl');
  const indexPath = path.join(outDir, 'vfs_manifest.vfsidx');
  const bloomPath = path.join(outDir, 'vfs_manifest.vfsbloom.json');
  const index = await loadVfsManifestIndex({ indexPath });
  const telemetry = [];

  const bloomMissPath = '.poc-vfs/src/missing.ts#seg:segu:v1:missing.ts';
  const bloomMiss = await loadVfsManifestRowByPath({
    manifestPath,
    indexPath,
    bloomPath,
    virtualPath: bloomMissPath,
    allowScan: true,
    telemetry
  });
  assert.equal(bloomMiss, null, 'expected bloom negative lookup to return null');
  assert.deepEqual(
    telemetry.filter((event) => event.virtualPath === bloomMissPath).map((event) => `${event.path}:${event.outcome}`),
    ['bloom:negative'],
    'expected bloom-negative lookup to short-circuit without vfsidx/scan'
  );

  telemetry.length = 0;
  const expectedRow = rows[0];
  const indexedHit = await loadVfsManifestRowByPath({
    manifestPath,
    indexPath,
    bloomPath,
    virtualPath: expectedRow.virtualPath,
    allowScan: true,
    telemetry
  });
  assert.deepEqual(indexedHit, expectedRow, 'expected vfsidx hit lookup to return matching row');
  assert.deepEqual(
    telemetry.map((event) => `${event.path}:${event.outcome}`),
    ['bloom:positive', 'vfsidx:hit'],
    'expected bloom positive then vfsidx hit telemetry'
  );

  telemetry.length = 0;
  const mismatchSource = rows[1];
  const mismatchEntry = index.get(mismatchSource.virtualPath);
  assert.ok(mismatchEntry, 'expected index entry for mismatch source row');
  const mismatchIndex = new Map([[expectedRow.virtualPath, mismatchEntry]]);
  const mismatchRecovered = await loadVfsManifestRowByPath({
    manifestPath,
    index: mismatchIndex,
    virtualPath: expectedRow.virtualPath,
    allowScan: true,
    telemetry
  });
  assert.deepEqual(mismatchRecovered, expectedRow, 'expected scan fallback to recover from index row mismatch');
  assert.deepEqual(
    telemetry.map((event) => `${event.path}:${event.outcome}`),
    ['vfsidx:mismatch', 'scan:hit'],
    'expected vfsidx mismatch telemetry before scan recovery'
  );

  telemetry.length = 0;
  const staleIndexHit = await loadVfsManifestRowByPath({
    manifestPath,
    index: new Map(),
    virtualPath: expectedRow.virtualPath,
    allowScan: true,
    telemetry
  });
  assert.deepEqual(staleIndexHit, expectedRow, 'expected scan fallback to recover from stale index misses');
  assert.deepEqual(
    telemetry.map((event) => `${event.path}:${event.outcome}`),
    ['vfsidx:miss', 'scan:hit'],
    'expected stale index miss to continue with scan fallback'
  );

  telemetry.length = 0;
  const scanHit = await loadVfsManifestRowByPath({
    manifestPath,
    virtualPath: expectedRow.virtualPath,
    allowScan: true,
    telemetry
  });
  assert.deepEqual(scanHit, expectedRow, 'expected scan fallback to return row');
  assert.deepEqual(
    telemetry.map((event) => `${event.path}:${event.outcome}`),
    ['scan:hit'],
    'expected scan fallback telemetry'
  );

  telemetry.length = 0;
  const scanDisabled = await loadVfsManifestRowByPath({
    manifestPath,
    virtualPath: '.poc-vfs/src/missing.ts#seg:segu:v1:none.ts',
    allowScan: false,
    telemetry
  });
  assert.equal(scanDisabled, null, 'expected disabled scan to return null');
  assert.deepEqual(
    telemetry.map((event) => `${event.path}:${event.outcome}`),
    ['scan:disabled'],
    'expected scan disabled telemetry'
  );

  const reader = createVfsManifestOffsetReader({ manifestPath, maxBufferPoolEntries: 4 });
  try {
    const requests = rows.map((row) => {
      const entry = index.get(row.virtualPath);
      assert.ok(entry, `expected index entry for ${row.virtualPath}`);
      return { offset: entry.offset, bytes: entry.bytes };
    });
    const loadedA = await readVfsManifestRowsAtOffsets({ manifestPath, requests, reader });
    const loadedB = await readVfsManifestRowsAtOffsets({ manifestPath, requests, reader });
    assert.deepEqual(
      loadedA.map((row) => row?.virtualPath || null),
      rows.map((row) => row.virtualPath),
      'expected batched offset loads to preserve row ordering'
    );
    assert.deepEqual(
      loadedB.map((row) => row?.virtualPath || null),
      rows.map((row) => row.virtualPath),
      'expected repeated batched reads to remain stable'
    );
    const stats = reader.stats();
    assert.equal(stats.handleOpens, 1, 'expected batched reader to reuse a single file handle');
    assert.ok(stats.batchCalls >= 2, 'expected batched reader to report batch calls');
    assert.ok(stats.bufferReuses >= 1, 'expected batched reader to reuse pooled buffers');
  } finally {
    await reader.close();
  }

  console.log('VFS fast-path telemetry contract test passed');
} finally {
  await rmDirRecursive(tempRoot);
}
