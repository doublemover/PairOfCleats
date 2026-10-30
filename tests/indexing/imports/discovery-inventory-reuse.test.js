import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { discoverEntries, discoverFilesForModes } from '../../../src/index/build/discover.js';
import { preprocessFiles } from '../../../src/index/build/preprocess.js';
import { runDiscovery } from '../../../src/index/build/indexer/steps/discover.js';
import { createFsExistsIndex } from '../../../src/index/build/import-resolution/fs-exists-index.js';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// Actual discovery/preprocess/import owners, ordinary files and injected faults.
// Authored only; no elapsed-time, large-workload or runtime acceptance claim.
ensureTestingEnv(process.env);
const root = await makeTempDir('poc-discovery-inventory-');
const readdir = fs.readdir, lstat = fs.lstat;
const countedIndex = async (entries, options = {}) => {
  const reads = [];
  fs.readdir = async (directory, ...args) => { reads.push(path.relative(root, directory)); return readdir(directory, ...args); };
  try { return { index: await createFsExistsIndex({ root, entries, ...options }), reads }; }
  finally { fs.readdir = readdir; }
};
try {
  await fs.mkdir(path.join(root, 'src'));
  await fs.mkdir(path.join(root, 'generated'));
  await fs.mkdir(path.join(root, 'dist'));
  await fs.writeFile(path.join(root, 'src', 'main.js'), 'export const value = 1;');
  await fs.writeFile(path.join(root, 'generated', 'target.inc'), 'import target excluded by discovery');
  await fs.writeFile(path.join(root, 'dist', 'bundle.js'), 'export {};');
  for (let index = 0; index < 100; index++) await fs.writeFile(path.join(root, `asset-${index}.data`), 'asset');
  const { ignoreMatcher } = await buildIgnoreMatcher({ root, userConfig: { extraIgnore: ['generated', 'dist'] } });
  const discovered = await discoverEntries({ root, modes: ['code'], ignoreMatcher });
  const reused = await countedIndex(discovered.entries);
  assert.equal(reused.index.reusedDirectoryCount, 2, 'root and src have complete raw directory receipts');
  assert.deepEqual(reused.reads, ['generated'], 'differently filtered import target directory is the delta scan');
  assert.equal(reused.index.lookup('src/main.js'), 'present');
  assert.equal(reused.index.lookup('asset-99.data'), 'present', 'unsupported index source can still be an import target');
  assert.equal(reused.index.lookup('generated/target.inc'), 'present');
  assert.equal(reused.index.lookup('dist/bundle.js'), 'unknown', 'existing import ignore authority remains');
  assert.equal(reused.index.lookup('missing.js'), 'absent');
  const standalone = await countedIndex(discovered.entries.map(entry => ({ ...entry })));
  assert.equal(standalone.index.reusedDirectoryCount, 0, 'copied source fields do not reconstruct complete directories');
  assert.ok(standalone.reads.includes('') && standalone.reads.includes('src'));
  for (const query of ['src/main.js', 'asset-99.data', 'generated/target.inc', 'dist/bundle.js', 'missing.js']) {
    assert.equal(reused.index.lookup(query), standalone.index.lookup(query));
  }

  const modes = await discoverFilesForModes({ root, modes: ['code'], ignoreMatcher });
  const ordered = await runDiscovery({ runtime: {}, mode: 'code', discovery: { entries: modes.code }, state: { skippedFiles: [] }, timing: {} });
  assert.equal((await countedIndex(ordered)).index.reusedDirectoryCount, 2, 'actual mode and ordering owners forward the receipt');
  const preprocessed = await preprocessFiles({ root, modes: ['code'], ignoreMatcher, lineCounts: false });
  assert.equal((await countedIndex(preprocessed.entriesByMode.code)).index.reusedDirectoryCount, 2, 'actual preprocess projection retains raw directory authority');

  const limited = await discoverEntries({ root, modes: ['code'], ignoreMatcher, maxFiles: 1 });
  const limitedIndex = await countedIndex(limited.entries);
  assert.equal(limitedIndex.index.lookup('src/main.js'), 'present');
  assert.equal(limitedIndex.index.lookup('generated/target.inc'), 'present');
  const capped = await countedIndex(discovered.entries, { resolverPlugins: { fsExistsIndex: { maxScanFiles: 1 } } });
  assert.equal(capped.index.complete, false);
  assert.equal(capped.index.lookup('never.js'), 'unknown', 'receipt reuse cannot override the import scan cap');

  const changed = await discoverEntries({ root, modes: ['code'], ignoreMatcher });
  await fs.writeFile(path.join(root, 'new-target.data'), 'new');
  await fs.rm(path.join(root, 'src', 'main.js'));
  // Force the original root/src stamp to differ without relying on timestamp
  // granularity. Actual fallback enumeration still reads the changed files.
  fs.lstat = async (directory, ...args) => {
    const stat = await lstat(directory, ...args);
    if (![path.resolve(root), path.join(root, 'src')].includes(path.resolve(directory)) || typeof stat.mtimeNs !== 'bigint') return stat;
    return Object.create(stat, { mtimeNs: { value: stat.mtimeNs + 1n } });
  };
  try {
    const fresh = await countedIndex(changed.entries);
    assert.ok(fresh.reads.includes('') && fresh.reads.includes('src'), 'changed directories are enumerated normally');
    assert.equal(fresh.index.lookup('new-target.data'), 'present');
    assert.equal(fresh.index.lookup('src/main.js'), 'absent', 'old selected records cannot resurrect a removed file');
  } finally { fs.lstat = lstat; }

  const current = await discoverEntries({ root, modes: ['code'], ignoreMatcher });
  let rootChecks = 0;
  fs.lstat = async (directory, ...args) => {
    const stat = await lstat(directory, ...args);
    if (path.resolve(directory) !== path.resolve(root) || ++rootChecks !== 2 || typeof stat.mtimeNs !== 'bigint') return stat;
    // Deterministic metadata change at final receipt revalidation, no wall clock.
    return Object.create(stat, { mtimeNs: { value: stat.mtimeNs + 1n } });
  };
  try {
    const invalidated = await countedIndex(current.entries);
    assert.equal(invalidated.index.complete, false);
    assert.equal(invalidated.index.lookup('new-target.data'), 'unknown');
    assert.equal(invalidated.index.lookup('absent.js'), 'unknown');
  } finally { fs.lstat = lstat; }

  fs.readdir = async (directory, ...args) => {
    if (path.resolve(directory) === path.join(root, 'generated')) throw Object.assign(new Error('inert unreadable delta'), { code: 'EACCES' });
    return readdir(directory, ...args);
  };
  try {
    const unreadable = await createFsExistsIndex({ root, entries: current.entries });
    assert.equal(unreadable.complete, false);
    assert.equal(unreadable.lookup('generated/missing.inc'), 'unknown');
  } finally { fs.readdir = readdir; }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createFsExistsIndex({ root, entries: current.entries, abortSignal: controller.signal }), { code: 'ABORT_ERR' });
} finally {
  fs.readdir = readdir; fs.lstat = lstat;
  await rmDirRecursive(root);
}
console.log('Discovery inventory/import reuse controls authored; execution deferred.');
