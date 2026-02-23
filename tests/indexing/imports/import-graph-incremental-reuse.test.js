#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sha1 } from '../../../src/shared/hash.js';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';
import { loadImportResolutionCache, saveImportResolutionCache } from '../../../src/index/build/import-resolution-cache.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'import-graph-incremental');
const srcRoot = path.join(tempRoot, 'src');
const incrementalDir = path.join(tempRoot, '.incremental');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(srcRoot, 'a'), { recursive: true });
await fs.mkdir(path.join(srcRoot, 'b'), { recursive: true });
await fs.mkdir(path.join(srcRoot, 'lib'), { recursive: true });
await fs.mkdir(path.join(srcRoot, 'alt'), { recursive: true });
await fs.mkdir(incrementalDir, { recursive: true });

const writeFile = async (rel, content, hashes) => {
  const abs = path.join(tempRoot, rel);
  await fs.writeFile(abs, content);
  hashes.set(rel.replace(/\\/g, '/'), sha1(content));
};

const writeTsconfig = async (paths) => {
  const payload = {
    compilerOptions: {
      baseUrl: '.',
      paths
    }
  };
  await fs.writeFile(path.join(tempRoot, 'tsconfig.json'), JSON.stringify(payload, null, 2));
};

const fileHashes = new Map();
await writeFile('src/a/utils.js', 'export const a = 1;\n', fileHashes);
await writeFile('src/a/index.js', "import './utils';\n", fileHashes);
await writeFile('src/b/utils.js', 'export const b = 2;\n', fileHashes);
await writeFile('src/b/index.js', "import './utils';\n", fileHashes);
await writeFile('src/lib/util.ts', 'export const util = true;\n', fileHashes);
await writeFile('src/alt/util.ts', 'export const alt = true;\n', fileHashes);
await writeFile('src/main.ts', "import '@lib/util';\nimport 'react';\n", fileHashes);
await writeFile('package.json', '{"name":"import-graph-incremental"}\n', fileHashes);

await writeTsconfig({ '@lib/*': ['src/lib/*'] });

const entries = [
  { abs: path.join(srcRoot, 'a', 'index.js'), rel: 'src/a/index.js' },
  { abs: path.join(srcRoot, 'a', 'utils.js'), rel: 'src/a/utils.js' },
  { abs: path.join(srcRoot, 'b', 'index.js'), rel: 'src/b/index.js' },
  { abs: path.join(srcRoot, 'b', 'utils.js'), rel: 'src/b/utils.js' },
  { abs: path.join(srcRoot, 'lib', 'util.ts'), rel: 'src/lib/util.ts' },
  { abs: path.join(srcRoot, 'alt', 'util.ts'), rel: 'src/alt/util.ts' },
  { abs: path.join(srcRoot, 'main.ts'), rel: 'src/main.ts' }
];

const importsByFile = {
  'src/a/index.js': ['./utils'],
  'src/b/index.js': ['./utils'],
  'src/main.ts': ['@lib/util', 'react']
};

const buildRelations = () => {
  const relations = new Map();
  for (const [file, imports] of Object.entries(importsByFile)) {
    relations.set(file, { imports: imports.slice() });
  }
  return relations;
};

const snapshot = (relations) => {
  const out = {};
  for (const [file, rel] of relations.entries()) {
    out[file] = {
      importLinks: rel.importLinks || [],
      externalImports: rel.externalImports || []
    };
  }
  return out;
};

const incrementalState = {
  enabled: true,
  incrementalDir,
  manifest: {
    files: Object.fromEntries(Array.from(fileHashes.entries()).map(([rel, hash]) => [rel, { hash }]))
  }
};

const runResolution = async () => {
  const { cache, cachePath } = await loadImportResolutionCache({ incrementalState });
  const relations = buildRelations();
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

const first = await runResolution();
assert.equal(first.cacheStats?.filesReused || 0, 0);

const second = await runResolution();
assert.ok((second.cacheStats?.filesReused || 0) > 0, 'expected cached reuse on second run');
assert.equal(JSON.stringify(snapshot(first.relations)), JSON.stringify(snapshot(second.relations)));

await writeTsconfig({ '@lib/*': ['src/alt/*'] });
const third = await runResolution();
const relMain = third.relations.get('src/main.ts');
assert.deepEqual(relMain.importLinks, ['src/alt/util.ts']);
assert.ok((third.cacheStats?.filesInvalidated || 0) >= 1);

console.log('import graph incremental reuse test passed');
