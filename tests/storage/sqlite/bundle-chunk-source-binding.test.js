import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { buildDatabaseFromBundles } from '../../../src/storage/sqlite/build/from-bundles.js';
import { loadBundlesAndCollectState } from '../../../src/storage/sqlite/build/incremental-update/planner.js';
import { writeIncrementalBundleSnapshot } from '../../../src/index/build/incremental/bundle-snapshot.js';
import { writeBundleFile } from '../../../src/shared/bundle-io.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

// UNRUN: actual full/incremental consumers with valid checksum-bearing bundles.
const { dir } = await prepareIsolatedTestCacheDir('sqlite-bundle-chunk-source-binding');
const file = 'folder/Éclair.js';
const entry = { hash: 'selected-source', size: 5, mtimeMs: 1 };
const sourceBundle = () => ({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  file, hash: entry.hash, size: entry.size,
  chunks: [{ file, start: 0, end: 1, tokens: ['selected-token'] }] });
const build = async (name, selected) => {
  const outPath = path.join(dir, `${name}.db`);
  const result = await buildDatabaseFromBundles({ Database, outPath, mode: 'code',
    incrementalData: { bundleDir: dir, manifest: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, files: { [file]: selected } } },
    envConfig: { bundleThreads: 1 }, threadLimits: { fileConcurrency: 1 },
    modelConfig: { id: null }, vectorConfig: { enabled: false }, emitOutput: false,
    validateMode: 'off', optimize: false, buildPragmas: false });
  return { result, outPath };
};
try {
  for (const identity of ['normalized', 'omitted']) {
    const bundle = sourceBundle();
    if (identity === 'normalized') bundle.chunks[0].file = './folder\\Éclair.js';
    else { delete bundle.file; delete bundle.chunks[0].file; }
    const name = `${identity}.json`;
    await writeBundleFile({ bundlePath: path.join(dir, name), bundle, format: 'json' });
    const { result, outPath } = await build(identity, { ...entry, bundles: [name] });
    assert.equal(result.count, 1, 'supported legacy omission and equivalent separators retain the selected manifest source');
    const db = new Database(outPath, { readonly: true });
    try { assert.deepEqual(db.prepare('SELECT file FROM chunks').all(), [{ file }]); }
    finally { db.close(); }
  }

  const corruptions = [
    bundle => { bundle.chunks[0].file = 'other.js'; },
    bundle => { bundle.file = 'other.js'; },
    bundle => { bundle.hash = 'other-hash'; },
    bundle => { bundle.size = 99; },
    bundle => { bundle.bundleShardIndex = 1; bundle.bundleShardCount = 1; },
    bundle => { bundle.bundleShardIndex = 0; bundle.bundleShardCount = 2; }
  ];
  for (let index = 0; index < corruptions.length; index++) {
    const bundle = sourceBundle();
    corruptions[index](bundle);
    const name = `legacy-invalid-${index}.json`;
    await writeBundleFile({ bundlePath: path.join(dir, name), bundle, format: 'json' });
    const { result, outPath } = await build(`legacy-invalid-${index}`, { ...entry, bundles: [name] });
    assert.equal(result.count, 0);
    assert.match(result.reason, /source differs/);
    await assert.rejects(fs.stat(outPath), { code: 'ENOENT' }, 'an invalid selected file cannot publish a successful partial database');
  }

  const wrongChunk = sourceBundle();
  wrongChunk.chunks[0].file = 'other.js';
  const descriptor = await writeIncrementalBundleSnapshot({ bundleDir: dir, relKey: file, entry, bundles: [wrongChunk] });
  const selected = { ...entry, ...descriptor };
  const incremental = await loadBundlesAndCollectState({ bundleDir: dir,
    changed: [{ file, normalized: file, entry: selected }] });
  assert.equal(incremental.ok, false, 'valid immutable outer source identity cannot authorize a foreign emitted chunk');
  const rejected = await build('modern-invalid', selected);
  assert.equal(rejected.result.count, 0);
  await assert.rejects(fs.stat(rejected.outPath), { code: 'ENOENT' });

  const valid = await writeIncrementalBundleSnapshot({ bundleDir: dir, relKey: file, entry, bundles: [sourceBundle()] });
  assert.equal((await loadBundlesAndCollectState({ bundleDir: dir,
    changed: [{ file, normalized: file, entry: { ...entry, ...valid } }] })).ok, true);
  assert.equal((await build('modern-valid', { ...entry, ...valid })).result.count, 1);
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('SQLite full and incremental consumers bind legacy/modern chunk paths and declared source/shard metadata before mutation.');
