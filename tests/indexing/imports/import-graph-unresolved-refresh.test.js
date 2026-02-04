#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sha1 } from '../../../src/shared/hash.js';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';
import { loadImportResolutionCache, saveImportResolutionCache } from '../../../src/index/build/import-resolution-cache.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'import-graph-unresolved-refresh');
const srcRoot = path.join(tempRoot, 'src');
const incrementalDir = path.join(tempRoot, '.incremental');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(srcRoot, { recursive: true });
await fs.mkdir(incrementalDir, { recursive: true });

const fileHashes = new Map();
const writeFile = async (rel, content) => {
  const abs = path.join(tempRoot, rel);
  await fs.writeFile(abs, content);
  fileHashes.set(rel.replace(/\\/g, '/'), sha1(content));
};

await writeFile('src/main.js', "import './missing';\n");
await writeFile('package.json', '{"name":"import-graph-unresolved-refresh"}\n');

const importsByFile = {
  'src/main.js': ['./missing']
};

const incrementalState = {
  enabled: true,
  incrementalDir,
  manifest: {
    files: Object.fromEntries(Array.from(fileHashes.entries()).map(([rel, hash]) => [rel, { hash }]))
  }
};

const runResolution = async (entries) => {
  const { cache, cachePath } = await loadImportResolutionCache({ incrementalState });
  const relations = new Map([['src/main.js', { imports: ['./missing'] }]]);
  const result = resolveImportLinks({
    root: tempRoot,
    entries,
    importsByFile,
    fileRelations: relations,
    enableGraph: false,
    cache,
    fileHashes
  });
  await saveImportResolutionCache({ cache, cachePath });
  return { relations, cacheStats: result.cacheStats };
};

const entriesInitial = [
  { abs: path.join(srcRoot, 'main.js'), rel: 'src/main.js' }
];

const first = await runResolution(entriesInitial);
const firstLinks = first.relations.get('src/main.js')?.importLinks || [];
assert.equal(firstLinks.length, 0, 'expected unresolved import to remain empty');

await writeFile('src/missing.js', 'export const ok = true;\n');
const entriesUpdated = [
  { abs: path.join(srcRoot, 'main.js'), rel: 'src/main.js' },
  { abs: path.join(srcRoot, 'missing.js'), rel: 'src/missing.js' }
];
incrementalState.manifest.files = Object.fromEntries(
  Array.from(fileHashes.entries()).map(([rel, hash]) => [rel, { hash }])
);

const second = await runResolution(entriesUpdated);
const secondLinks = second.relations.get('src/main.js')?.importLinks || [];
assert.deepEqual(secondLinks, ['src/missing.js']);

console.log('import graph unresolved refresh test passed');
