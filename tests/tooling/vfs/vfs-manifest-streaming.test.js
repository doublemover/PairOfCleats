#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createVfsStreamingFixture } from '../../helpers/vfs-streaming-fixture.js';

const fixture = await createVfsStreamingFixture({ tempPrefix: 'pairofcleats-vfs-streaming-' });

try {
  assert.ok(fixture.collector.stats.runsSpilled >= 1, 'expected collector to spill runs');
  assert.ok(fixture.totalBytes > fixture.maxLineBytes + 1, 'fixture should be large enough to force sharding');

  const loaded = await fixture.writeAndLoad();

  assert.deepStrictEqual(loaded, fixture.expected, 'streamed vfs_manifest should preserve global ordering');
  await fs.stat(path.join(fixture.outDir, 'vfs_manifest.meta.json'));
  await fs.stat(path.join(fixture.outDir, 'vfs_manifest.parts'));

  console.log('VFS manifest streaming test passed');
} finally {
  await fixture.cleanup();
}
