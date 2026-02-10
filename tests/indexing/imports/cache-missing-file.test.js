#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'import-cache-missing-file');
const srcRoot = path.join(tempRoot, 'src');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(srcRoot, { recursive: true });
await fs.writeFile(path.join(srcRoot, 'main.js'), "import './target.js';\n");
await fs.writeFile(path.join(srcRoot, 'target.js'), 'export const target = 1;\n');

const importsByFile = {
  'src/main.js': ['./target.js']
};
const fileHashes = new Map([['src/main.js', 'hash-main']]);
const cache = {};

const buildEntries = () => ([
  { abs: path.join(srcRoot, 'main.js'), rel: 'src/main.js' },
  { abs: path.join(srcRoot, 'target.js'), rel: 'src/target.js' }
]);

const buildRelations = () => new Map([
  ['src/main.js', { imports: ['./target.js'] }]
]);

const runOnce = (entries, stats) => {
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

const statsA = {
  files: 0,
  filesHashed: 0,
  filesReused: 0,
  filesInvalidated: 0,
  specs: 0,
  specsReused: 0,
  specsComputed: 0,
  packageInvalidated: false,
  fileSetInvalidated: false
};
const relA = runOnce(buildEntries(), statsA);
assert.deepEqual(relA.importLinks, ['src/target.js']);

await fs.rm(path.join(srcRoot, 'target.js'));
const statsB = { ...statsA };
const relB = runOnce([{ abs: path.join(srcRoot, 'main.js'), rel: 'src/main.js' }], statsB);
assert.deepEqual(relB.importLinks, [], 'expected cached resolved imports to invalidate when target missing');
assert.equal(statsB.fileSetInvalidated, true, 'expected file set invalidation for missing file');

console.log('import cache missing-file invalidation test passed');
