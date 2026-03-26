#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildVfsManifestRowsForFile,
  compareVfsManifestRows,
  loadVfsManifestRowByPath
} from '../../../src/index/tooling/vfs.js';
import { buildVfsIndexRows } from '../../../src/index/tooling/vfs-index.js';
import { enqueueVfsManifestArtifacts } from '../../../src/index/build/artifacts/writers/vfs-manifest.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const runWriter = async ({ outDir, mode, rows }) => {
  const writes = [];
  await enqueueVfsManifestArtifacts({
    outDir,
    mode,
    rows,
    maxJsonBytes: 1000000,
    compression: null,
    gzipOptions: null,
    hashRouting: false,
    enqueueWrite: (label, fn) => writes.push({ label, fn }),
    addPieceFile: () => {},
    formatArtifactLabel: (value) => value
  });
  for (const write of writes) {
    await write.fn();
  }
};

{
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
      segmentStart: 5,
      segmentEnd: 10,
      lineStart: 1,
      lineEnd: 1
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
      segmentEnd: 4,
      lineStart: 1,
      lineEnd: 1
    }
  ];
  const indexRows = buildVfsIndexRows(rows);
  assert.equal(indexRows.length, rows.length);
  for (const row of indexRows) {
    assert.ok(row.manifestSortKey);
  }

  const sortedManifest = rows.slice().sort(compareVfsManifestRows).map((row) => row.virtualPath);
  const sortedIndex = indexRows
    .slice()
    .sort((a, b) => String(a.manifestSortKey).localeCompare(String(b.manifestSortKey)))
    .map((row) => row.virtualPath);
  assert.deepStrictEqual(sortedIndex, sortedManifest);
}

{
  const tempRoot = await makeTempDir('poc-vfs-lookup-contract-');
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
    assert.equal(notFound, null);
    assert.equal(
      await loadVfsManifestRowByPath({ manifestPath, virtualPath: missingPath, allowScan: false }),
      null
    );
    assert.equal(
      await loadVfsManifestRowByPath({ manifestPath, virtualPath: missingPath, allowScan: true }),
      null
    );
  } finally {
    await rmDirRecursive(tempRoot);
  }
}

{
  const tempRoot = await makeTempDir('poc-vfs-lookup-load-error-');
  const manifestPath = path.join(tempRoot, 'vfs_manifest.jsonl');
  const indexPath = path.join(tempRoot, 'vfs_manifest.vfsidx');

  try {
    const row = {
      virtualPath: '.poc-vfs/src/app.js',
      docHash: 'xxh64:abc',
      segmentStart: 0,
      segmentEnd: 10
    };
    await fs.writeFile(manifestPath, `${JSON.stringify(row)}\n`, 'utf8');
    await fs.writeFile(indexPath, '{not-json}\n', 'utf8');

    const telemetry = [];
    const resolved = await loadVfsManifestRowByPath({
      manifestPath,
      indexPath,
      virtualPath: row.virtualPath,
      allowScan: true,
      telemetry
    });

    assert.ok(resolved);
    assert.equal(resolved.virtualPath, row.virtualPath);
    assert.ok(
      telemetry.some((event) => event?.path === 'vfsidx' && event?.outcome === 'load_error')
    );
  } finally {
    await rmDirRecursive(tempRoot);
  }
}

console.log('vfs lookup contract matrix test passed');
