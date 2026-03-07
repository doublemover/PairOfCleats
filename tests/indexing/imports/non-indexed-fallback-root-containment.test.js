#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testLogs', 'import-non-indexed-fallback-root-containment');
const repoRoot = path.join(tempRoot, 'repo');
const srcRoot = path.join(repoRoot, 'src');
const outsideRoot = path.join(tempRoot, 'outside');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(srcRoot, { recursive: true });
await fs.mkdir(outsideRoot, { recursive: true });

await fs.writeFile(path.join(srcRoot, 'main.js'), "import '../../outside/helper.js';\n");
await fs.writeFile(path.join(outsideRoot, 'helper.js'), 'export const helper = true;\n');

const entries = [
  { abs: path.join(srcRoot, 'main.js'), rel: 'src/main.js' }
];
const importsByFile = {
  'src/main.js': ['../../outside/helper.js']
};
const relations = new Map([
  ['src/main.js', { imports: ['../../outside/helper.js'] }]
]);

const result = resolveImportLinks({
  root: repoRoot,
  entries,
  importsByFile,
  fileRelations: relations,
  enableGraph: false
});
const rel = relations.get('src/main.js');

assert.deepEqual(
  rel?.importLinks || [],
  [],
  'expected escaped fallback probe to avoid local resolution'
);
assert.deepEqual(
  rel?.externalImports || [],
  [],
  'expected escaped fallback probe to avoid stable external classification'
);
assert.equal(
  result?.stats?.unresolved || 0,
  1,
  'expected escaped fallback probe to remain unresolved'
);

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('import non-indexed fallback root containment test passed');
