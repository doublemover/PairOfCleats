#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { loadVfsManifestRowByPath } from '../../../src/index/tooling/vfs/lookup.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

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

  assert.ok(resolved, 'expected scan fallback to return row when vfs index is invalid');
  assert.equal(resolved.virtualPath, row.virtualPath);
  assert.ok(
    telemetry.some((event) => event?.path === 'vfsidx' && event?.outcome === 'load_error'),
    'expected telemetry to record vfsidx load_error fallback event'
  );

  console.log('vfs index lookup load error fallback test passed');
} finally {
  await rmDirRecursive(tempRoot);
}
