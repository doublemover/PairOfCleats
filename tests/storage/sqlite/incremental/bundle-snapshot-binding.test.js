#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadBundlesAndCollectState } from '../../../../src/storage/sqlite/build/incremental-update/planner.js';
import { writeIncrementalBundleSnapshot } from '../../../../src/index/build/incremental/bundle-snapshot.js';
import { writeBundleFile } from '../../../../src/shared/bundle-io.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-sqlite-bundle-binding-'));
try {
  const file = 'a.js', entry = { hash: 'source-a', size: 5 };
  const descriptor = await writeIncrementalBundleSnapshot({ bundleDir: root, relKey: file, entry,
    bundles: [{ file, hash: entry.hash, size: entry.size, chunks: [{ file, tokens: ['right-source'] }] }] });
  const selected = { ...entry, ...descriptor };
  const load = value => loadBundlesAndCollectState({ bundleDir: root,
    changed: [{ file, normalized: file, entry: value }] });
  assert.equal((await load(selected)).ok, true);
  for (const patch of [{ hash: 'different-hash' }, { size: 99 },
    { bundleInventory: selected.bundleInventory.map(part => ({ ...part, index: 1 })) }]) {
    assert.equal((await load({ ...selected, ...patch })).ok, false);
  }
  const filename = path.join(root, selected.bundles[0]);
  await writeBundleFile({ bundlePath: filename, format: 'json', bundle: { file: 'b.js', hash: entry.hash,
    size: entry.size, bundleShardIndex: 0, bundleShardCount: 1, chunks: [{ file: 'b.js', tokens: ['wrong-source'] }] } });
  assert.equal((await load(selected)).ok, false, 'individually valid bundle checksum cannot replace selected source identity');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('SQLite incremental planning binds source, size, hash, shard ordinal, and immutable content');
