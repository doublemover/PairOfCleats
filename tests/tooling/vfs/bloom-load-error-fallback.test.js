#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { loadVfsManifestRowByPath } from '../../../src/index/tooling/vfs.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const tempRoot = await makeTempDir('pairofcleats-vfs-bloom-load-error-');

try {
  const manifestPath = path.join(tempRoot, 'vfs_manifest.jsonl');
  const bloomPath = path.join(tempRoot, 'vfs_manifest.vfsbloom.json');
  const virtualPath = '.poc-vfs/src/app.js#seg:segu:v1:abc.js';
  const row = { virtualPath, chunks: [{ chunkUid: 'ck:1', symbol: 'x' }] };
  await fs.writeFile(manifestPath, `${JSON.stringify(row)}\n`, 'utf8');
  await fs.writeFile(bloomPath, '{not-valid-json', 'utf8');

  const telemetry = [];
  const resolved = await loadVfsManifestRowByPath({
    manifestPath,
    bloomPath,
    virtualPath,
    allowScan: true,
    telemetry
  });

  assert.deepEqual(resolved, row, 'expected scan fallback to recover row when bloom payload is invalid');
  assert.equal(
    telemetry.some((event) => event?.path === 'bloom' && event?.outcome === 'load_error'),
    true,
    'expected bloom load_error telemetry event'
  );
  assert.equal(
    telemetry.some((event) => event?.path === 'scan' && event?.outcome === 'hit'),
    true,
    'expected scan hit telemetry event after bloom load error'
  );
  console.log('vfs bloom load error fallback test passed');
} finally {
  await rmDirRecursive(tempRoot);
}
