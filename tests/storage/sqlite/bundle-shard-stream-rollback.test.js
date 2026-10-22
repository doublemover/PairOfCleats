#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { applyTestEnv } from '../../helpers/test-env.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { writeBundleFile } from '../../../src/shared/bundle-io.js';
import { writeIncrementalBundleSnapshot } from '../../../src/index/build/incremental/bundle-snapshot.js';
import { buildDatabaseFromBundles } from '../../../src/storage/sqlite/build/from-bundles.js';
applyTestEnv({ testing: '1' });
const parent = path.resolve('.tmp/tasks/sqlite-shard-stream'); await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'rollback-')), bundleDir = path.join(root, 'bundles');
await fs.mkdir(bundleDir);
try {
  const file = 'z/source.js', second = 'a/source.js';
  const chunk = (source, start, token) => ({ file: source, start, end: start + 1, tokens: [token] });
  for (const [name, source, start, token] of [['a1.json', file, 0, 'first'], ['a2.json', file, 1, 'second'], ['b.json', second, 0, 'third']]) {
    await writeBundleFile({ bundlePath: path.join(bundleDir, name), bundle: { file: source, chunks: [chunk(source, start, token)] } });
  }
  const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, files: {
    [file]: { bundles: ['a1.json', 'a2.json'], size: 2, mtimeMs: 1 },
    [second]: { bundles: ['b.json'], size: 1, mtimeMs: 1 }
  } };
  const output = path.join(root, 'index.db'), stats = {};
  const build = (selected = manifest) => buildDatabaseFromBundles({ Database, outPath: output, repoRoot: root, mode: 'code',
    incrementalData: { manifest: selected, bundleDir }, envConfig: { bundleThreads: 1 }, threadLimits: { fileConcurrency: 1 },
    emitOutput: false, validateMode: 'off', vectorConfig: { enabled: false }, modelConfig: {}, stats });
  assert.equal((await build()).count, 3);
  const db = new Database(output, { readonly: true });
  try { assert.deepEqual(db.prepare('SELECT id, file FROM chunks ORDER BY id').all().map(row => [row.id, row.file]),
    [[0, file], [1, file], [2, second]], 'manifest then shard order owns fallback doc IDs'); }
  finally { db.close(); }
  assert.equal(stats.bundlePipeline.decodedShards, 3);
  assert.equal(stats.bundlePipeline.currentReservedBytes, 0);
  const authority = await fs.readFile(output);
  await fs.writeFile(path.join(bundleDir, 'a2.json'), '{');
  const failed = await build();
  assert.equal(failed.count, 0); assert.ok(failed.reason);
  assert.deepEqual(await fs.readFile(output), authority, 'later corrupt shard rolls back earlier inserted rows and retains old database');
  const selectedEntry = { hash: 'source-hash', size: 2, mtimeMs: 1, dependencySignatures: { parse: 'p1' } };
  const original = { file, ...selectedEntry, chunks: [chunk(file, 0, 'original')] };
  const snapshot = await writeIncrementalBundleSnapshot({ repoRoot: root, bundleDir, relKey: file,
    entry: selectedEntry, bundles: [original] });
  // Replace both independently valid payload/checksum bytes at the selected
  // name. Own checksum success must not authorize a different manifest product.
  await writeBundleFile({ bundlePath: path.join(bundleDir, snapshot.bundles[0]),
    bundle: { ...original, bundleShardIndex: 0, bundleShardCount: 1, chunks: [chunk(file, 0, 'forged')] } });
  const rebound = await build({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    files: { [file]: { ...selectedEntry, ...snapshot } } });
  assert.equal(rebound.count, 0); assert.match(rebound.reason, /selected manifest snapshot/);
  assert.deepEqual(await fs.readFile(output), authority);
} finally { await fs.rm(root, { recursive: true, force: true }); }
