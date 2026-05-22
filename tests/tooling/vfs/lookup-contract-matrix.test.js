#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  compareVfsManifestRows,
  loadVfsManifestRowByPath
} from '../../../src/index/tooling/vfs.js';
import { buildVfsIndexRows } from '../../../src/index/tooling/vfs-index.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { createSingleSegmentVfsManifestFixture } from '../../helpers/vfs-streaming-fixture.js';

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
  const fixture = await createSingleSegmentVfsManifestFixture({
    tempPrefix: 'poc-vfs-lookup-contract-'
  });

  try {
    await fixture.writeManifest();
    const missingPath = '.poc-vfs/missing.md#seg:missing';

    const notFound = await loadVfsManifestRowByPath({
      manifestPath: fixture.manifestPath,
      indexPath: fixture.indexPath,
      bloomPath: fixture.bloomPath,
      virtualPath: missingPath
    });
    assert.equal(notFound, null);
    assert.equal(
      await loadVfsManifestRowByPath({
        manifestPath: fixture.manifestPath,
        virtualPath: missingPath,
        allowScan: false
      }),
      null
    );
    assert.equal(
      await loadVfsManifestRowByPath({
        manifestPath: fixture.manifestPath,
        virtualPath: missingPath,
        allowScan: true
      }),
      null
    );
  } finally {
    await fixture.cleanup();
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
