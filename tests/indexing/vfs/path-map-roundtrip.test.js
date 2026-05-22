#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { buildVfsHashVirtualPath } from '../../../src/index/tooling/vfs.js';
import { createSingleSegmentVfsManifestFixture } from '../../helpers/vfs-streaming-fixture.js';

const fixture = await createSingleSegmentVfsManifestFixture({ tempPrefix: 'pairofcleats-vfs-map-' });

try {
  await fixture.writeManifest({ hashRouting: true });

  const contents = await fs.readFile(fixture.mapPath, 'utf8');
  const line = contents.trim();
  assert.ok(line, 'expected vfs_path_map content');
  const entry = JSON.parse(line);
  const row = fixture.rows[0];
  assert.equal(entry.virtualPath, row.virtualPath);
  const expectedHash = buildVfsHashVirtualPath({
    docHash: row.docHash,
    effectiveExt: row.effectiveExt
  });
  assert.equal(entry.hashVirtualPath, expectedHash);
  assert.equal(entry.containerPath, row.containerPath);
  assert.equal(entry.segmentUid, row.segmentUid);
  assert.equal(entry.segmentStart, row.segmentStart);
  assert.equal(entry.segmentEnd, row.segmentEnd);

  console.log('vfs path map ok');
} finally {
  await fixture.cleanup();
}
