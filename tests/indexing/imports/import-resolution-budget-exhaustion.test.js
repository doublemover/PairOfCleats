#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';
import { enrichUnresolvedImportSamples } from '../../../src/index/build/imports.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'import-resolution-budget-exhaustion');
const srcRoot = path.join(tempRoot, 'src');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(srcRoot, { recursive: true });
await fs.writeFile(
  path.join(srcRoot, 'main.js'),
  "import './missing-a';\nimport './missing-b';\n",
  'utf8'
);

const entries = [
  { abs: path.join(srcRoot, 'main.js'), rel: 'src/main.js' }
];
const importsByFile = {
  'src/main.js': ['./missing-a', './missing-b']
};
const relations = new Map([
  ['src/main.js', { imports: importsByFile['src/main.js'].slice() }]
]);

const result = resolveImportLinks({
  root: tempRoot,
  entries,
  importsByFile,
  fileRelations: relations,
  enableGraph: true,
  resolverPlugins: {
    budgets: {
      maxFilesystemProbesPerSpecifier: 0,
      maxFallbackCandidatesPerSpecifier: 8
    }
  }
});

const unresolved = enrichUnresolvedImportSamples(result?.unresolvedSamples || []);
assert.equal(unresolved.length, 2, 'expected unresolved samples for both missing imports');
for (const sample of unresolved) {
  assert.equal(sample.reasonCode, 'IMP_U_RESOLVER_BUDGET_EXHAUSTED');
  assert.equal(sample.failureCause, 'resolver_gap');
  assert.equal(sample.disposition, 'suppress_gate');
  assert.equal(sample.resolverStage, 'filesystem_probe');
  assert.equal(sample.category, 'resolver_gap');
}

assert.equal(result?.stats?.unresolvedBudgetExhausted, 2);
assert.deepEqual(
  Object.fromEntries(Object.entries(result?.stats?.unresolvedBudgetExhaustedByType || {})),
  { filesystem_probe: 2 }
);
assert.equal(
  result?.stats?.resolverPipelineStages?.filesystem_probe?.budgetExhausted || 0,
  2,
  'expected stage pipeline budget-exhausted counter for filesystem_probe'
);
assert.equal(
  result?.stats?.resolverPipelineStages?.filesystem_probe?.degraded || 0,
  2,
  'expected stage pipeline degraded counter for suppress-gate filesystem_probe unresolved samples'
);
assert.equal(result?.graph?.stats?.unresolvedBudgetExhausted, 2);
assert.deepEqual(
  Object.fromEntries(Object.entries(result?.graph?.stats?.unresolvedBudgetExhaustedByType || {})),
  { filesystem_probe: 2 }
);
assert.equal(
  result?.graph?.stats?.resolverPipelineStages?.filesystem_probe?.budgetExhausted || 0,
  2,
  'expected graph stage pipeline budget-exhausted counter for filesystem_probe'
);
assert.equal(
  result?.graph?.stats?.resolverPipelineStages?.filesystem_probe?.degraded || 0,
  2,
  'expected graph stage pipeline degraded counter for suppress-gate filesystem_probe unresolved samples'
);

console.log('import resolution budget exhaustion tests passed');
