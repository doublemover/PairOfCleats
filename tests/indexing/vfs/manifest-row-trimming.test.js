#!/usr/bin/env node
import assert from 'node:assert/strict';

import { createVfsRowTrimFixture } from '../../helpers/vfs-streaming-fixture.js';

const MAX_ROW_BYTES = 32 * 1024;

const fixture = await createVfsRowTrimFixture({ tempPrefix: 'pairofcleats-vfs-trim-' });

try {
  const { baseRows } = fixture;
  assert.equal(baseRows.length, 1, 'expected a base vfs manifest row');

  const loaded = await fixture.writeOversizedExtensionsAndLoad();

  assert.equal(loaded.length, 1, 'trimmed row should still be emitted');
  assert.equal(loaded[0].segmentId, baseRows[0].segmentId, 'segmentId should be preserved');
  assert.ok(!loaded[0].extensions, 'extensions should be trimmed when oversize');

  const rowBytes = Buffer.byteLength(JSON.stringify(loaded[0]), 'utf8');
  assert.ok(rowBytes <= MAX_ROW_BYTES, 'trimmed row should fit within MAX_ROW_BYTES');

  console.log('VFS manifest row trimming ok');
} finally {
  await fixture.cleanup();
}
