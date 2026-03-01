#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';
import { enrichUnresolvedImportSamples } from '../../../src/index/build/imports.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'import-resolution-fallback-depth-budget');
const nestedRoot = path.join(tempRoot, 'src', 'nested');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(nestedRoot, { recursive: true });
await fs.writeFile(path.join(nestedRoot, 'main.js'), "import '../../../missing';\n", 'utf8');

const entries = [
  { abs: path.join(nestedRoot, 'main.js'), rel: 'src/nested/main.js' }
];
const importsByFile = {
  'src/nested/main.js': ['../../../missing']
};
const relations = new Map([
  ['src/nested/main.js', { imports: importsByFile['src/nested/main.js'].slice() }]
]);

const result = resolveImportLinks({
  root: tempRoot,
  entries,
  importsByFile,
  fileRelations: relations,
  enableGraph: true,
  resolverPlugins: {
    budgets: {
      maxFilesystemProbesPerSpecifier: 32,
      maxFallbackCandidatesPerSpecifier: 32,
      maxFallbackDepth: 1
    }
  }
});

const unresolved = enrichUnresolvedImportSamples(result?.unresolvedSamples || []);
assert.equal(unresolved.length, 1);
assert.equal(unresolved[0].reasonCode, 'IMP_U_RESOLVER_BUDGET_EXHAUSTED');
assert.equal(unresolved[0].failureCause, 'resolver_gap');
assert.equal(unresolved[0].resolverStage, 'filesystem_probe');

assert.equal(result?.stats?.unresolvedBudgetExhausted, 1);
assert.deepEqual(
  Object.fromEntries(Object.entries(result?.stats?.unresolvedBudgetExhaustedByType || {})),
  { fallback_depth: 1 }
);
assert.equal(result?.graph?.stats?.unresolvedBudgetExhausted, 1);
assert.deepEqual(
  Object.fromEntries(Object.entries(result?.graph?.stats?.unresolvedBudgetExhaustedByType || {})),
  { fallback_depth: 1 }
);

console.log('import resolution fallback depth budget tests passed');
