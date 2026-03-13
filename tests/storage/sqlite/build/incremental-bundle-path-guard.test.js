#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadBundlesAndCollectState } from '../../../../src/storage/sqlite/build/incremental-update/planner.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-incremental-bundle-path-guard-'));
const bundleDir = path.join(root, 'bundles');
await fs.mkdir(bundleDir, { recursive: true });

try {
  const result = await loadBundlesAndCollectState({
    changed: [
      {
        file: 'src/a.js',
        normalized: 'src/a.js',
        entry: { bundles: ['../escape.bundle.json'] }
      }
    ],
    bundleDir
  });

  assert.equal(result?.ok, false, 'expected traversal bundle path to be rejected');
  assert.match(
    String(result?.reason || ''),
    /(invalid bundle path|missing bundle)/i,
    'expected traversal bundle entry to be rejected'
  );

  console.log('sqlite incremental bundle path guard test passed');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
