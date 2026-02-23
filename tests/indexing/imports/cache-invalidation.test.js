#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'import-cache-invalidation');
const srcRoot = path.join(tempRoot, 'src');

const makeStats = () => ({
  files: 0,
  filesHashed: 0,
  filesReused: 0,
  filesInvalidated: 0,
  specs: 0,
  specsReused: 0,
  specsComputed: 0,
  packageInvalidated: false,
  fileSetInvalidated: false
});

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(srcRoot, { recursive: true });
await fs.writeFile(path.join(srcRoot, 'main.js'), "import './later.js';\n");

const importsByFile = {
  'src/main.js': ['./later.js']
};

const fileHashes = new Map([
  ['src/main.js', 'hash-main']
]);

const buildEntries = (includeLater) => {
  const entries = [
    { abs: path.join(srcRoot, 'main.js'), rel: 'src/main.js' }
  ];
  if (includeLater) {
    entries.push({ abs: path.join(srcRoot, 'later.js'), rel: 'src/later.js' });
  }
  return entries;
};

const buildRelations = () => new Map([
  ['src/main.js', { imports: ['./later.js'] }]
]);

const cache = {};

const runOnce = ({ entries, stats }) => {
  const relations = buildRelations();
  resolveImportLinks({
    root: tempRoot,
    entries,
    importsByFile,
    fileRelations: relations,
    enableGraph: false,
    cache,
    cacheStats: stats,
    fileHashes,
    mode: 'code'
  });
  return relations.get('src/main.js');
};

const statsA = makeStats();
const relA = runOnce({ entries: buildEntries(false), stats: statsA });
assert.deepEqual(relA.importLinks, [], 'expected unresolved import to have no importLinks');
assert.equal(statsA.fileSetInvalidated, true, 'expected initial run to seed file-set fingerprint');

await fs.writeFile(path.join(srcRoot, 'later.js'), 'export const later = 1;\n');
const statsB = makeStats();
const relB = runOnce({ entries: buildEntries(true), stats: statsB });
assert.deepEqual(relB.importLinks, ['src/later.js'], 'expected cache to re-resolve after file set change');
assert.equal(statsB.fileSetInvalidated, true, 'expected file-set invalidation when new file added');

await fs.rm(path.join(srcRoot, 'later.js'));
const statsC = makeStats();
const relC = runOnce({ entries: buildEntries(false), stats: statsC });
assert.deepEqual(relC.importLinks, [], 'expected resolved imports to invalidate when file removed');
assert.equal(statsC.fileSetInvalidated, true, 'expected file-set invalidation when file removed');

console.log('import cache invalidation tests passed');
