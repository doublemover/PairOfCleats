#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { VFS_MANIFEST_MAX_ROW_BYTES } from '../../../src/index/tooling/vfs.js';
import {
  createVfsRowTrimFixture,
  runVfsManifestWriter
} from '../../helpers/vfs-streaming-fixture.js';

const fixture = await createVfsRowTrimFixture({ tempPrefix: 'pairofcleats-vfs-row-size-' });

try {
  const { baseRows, tempRoot } = fixture;
  assert.equal(baseRows.length, 1, 'expected a base vfs manifest row');

  const loaded = await fixture.writeOversizedExtensionsAndLoad();

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
  await runVfsManifestWriter({ outDir: dropDir, mode: 'code', rows: [huge], maxJsonBytes: 1024 * 1024 });
  let hasManifest = true;
  try {
    await fs.stat(path.join(dropDir, 'vfs_manifest.jsonl'));
  } catch {
    hasManifest = false;
  }
  assert.equal(hasManifest, false, 'oversize row should result in no manifest file');

  console.log('VFS row size trimming test passed');
} finally {
  await fixture.cleanup();
}
