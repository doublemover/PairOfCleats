#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  loadVfsManifestIndex,
  loadVfsManifestRowByPath
} from '../../../src/index/tooling/vfs.js';
import { createSingleSegmentVfsManifestFixture } from '../../helpers/vfs-streaming-fixture.js';

const fixture = await createSingleSegmentVfsManifestFixture({ tempPrefix: 'pairofcleats-vfs-idx-' });

try {
  await fixture.writeManifest();

  await fs.stat(fixture.indexPath);

  const index = await loadVfsManifestIndex({ indexPath: fixture.indexPath });
  assert.equal(index.size, fixture.rows.length);

  const row = fixture.rows[0];
  const loaded = await loadVfsManifestRowByPath({
    manifestPath: fixture.manifestPath,
    index,
    virtualPath: row.virtualPath
  });
  assert.deepStrictEqual(loaded, row);

  console.log('vfs index lookup ok');
} finally {
  await fixture.cleanup();
}
