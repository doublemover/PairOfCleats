#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createFsExistsIndex,
  resolveImportLinks
} from '../../../src/index/build/import-resolution.js';
import { enrichUnresolvedImportSamples } from '../../../src/index/build/imports.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'import-resolution-fs-exists-index-budget-shortcircuit');
const srcRoot = path.join(tempRoot, 'src');
const vendorRoot = path.join(tempRoot, 'vendor');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(srcRoot, { recursive: true });
await fs.mkdir(vendorRoot, { recursive: true });
await fs.writeFile(path.join(srcRoot, 'main.js'), "import '../vendor/local.js';\n", 'utf8');
await fs.writeFile(path.join(vendorRoot, 'local.js'), 'export const local = true;\n', 'utf8');

const entries = [
  { abs: path.join(srcRoot, 'main.js'), rel: 'src/main.js' }
];
const importsByFile = {
  'src/main.js': ['../vendor/local.js']
};

const baselineRelations = new Map([
  ['src/main.js', { imports: ['../vendor/local.js'] }]
]);
const baseline = resolveImportLinks({
  root: tempRoot,
  entries,
  importsByFile,
  fileRelations: baselineRelations,
  enableGraph: true,
  resolverPlugins: {
    budgets: {
      maxFilesystemProbesPerSpecifier: 0,
      maxFallbackCandidatesPerSpecifier: 16
    }
  }
});
const baselineUnresolved = enrichUnresolvedImportSamples(baseline?.unresolvedSamples || []);
assert.equal(baselineRelations.get('src/main.js')?.externalImports?.length || 0, 0);
assert.equal(baseline?.stats?.unresolvedBudgetExhausted, 1);
assert.equal(baselineUnresolved[0]?.reasonCode, 'IMP_U_RESOLVER_BUDGET_EXHAUSTED');

const fsExistsIndex = await createFsExistsIndex({
  root: tempRoot,
  entries
});
const acceleratedRelations = new Map([
  ['src/main.js', { imports: ['../vendor/local.js'] }]
]);
const accelerated = resolveImportLinks({
  root: tempRoot,
  entries,
  importsByFile,
  fileRelations: acceleratedRelations,
  enableGraph: true,
  fsExistsIndex,
  resolverPlugins: {
    budgets: {
      maxFilesystemProbesPerSpecifier: 0,
      maxFallbackCandidatesPerSpecifier: 16
    }
  }
});
assert.deepEqual(
  acceleratedRelations.get('src/main.js')?.externalImports || [],
  ['../vendor/local.js'],
  'expected fs-exists-index exact hit to bypass fs probe budget exhaustion'
);
assert.equal(accelerated?.stats?.unresolvedBudgetExhausted, 0);
assert.equal(accelerated?.stats?.resolverFsExistsIndex?.exactHits, 1);
assert.equal(accelerated?.stats?.resolverFsExistsIndex?.negativeSkips, 0);

console.log('import resolution fs exists index budget shortcircuit test passed');
