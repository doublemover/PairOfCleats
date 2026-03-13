#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sha1 } from '../../../src/shared/hash.js';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';
import {
  loadImportResolutionCache,
  saveImportResolutionCache,
  updateImportResolutionDiagnosticsCache
} from '../../../src/index/build/import-resolution-cache.js';
import {
  enrichUnresolvedImportSamples,
  summarizeUnresolvedImportTaxonomy
} from '../../../src/index/build/imports.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'import-graph-budget-diagnostics');
const srcRoot = path.join(tempRoot, 'src');
const incrementalDir = path.join(tempRoot, '.incremental');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(srcRoot, { recursive: true });
await fs.mkdir(incrementalDir, { recursive: true });
await fs.writeFile(path.join(srcRoot, 'main.js'), "import './missing';\n", 'utf8');
await fs.writeFile(path.join(tempRoot, 'package.json'), '{"name":"import-graph-budget-diagnostics"}\n', 'utf8');

const fileHashes = new Map();
fileHashes.set('src/main.js', sha1("import './missing';\n"));
fileHashes.set('package.json', sha1('{"name":"import-graph-budget-diagnostics"}\n'));

const incrementalState = {
  enabled: true,
  incrementalDir,
  manifest: {
    files: Object.fromEntries(Array.from(fileHashes.entries()).map(([rel, hash]) => [rel, { hash }]))
  }
};

const entries = [
  { abs: path.join(srcRoot, 'main.js'), rel: 'src/main.js' }
];
const importsByFile = {
  'src/main.js': ['./missing']
};

const runResolution = async (resolverPlugins) => {
  const { cache, cachePath } = await loadImportResolutionCache({ incrementalState });
  const relations = new Map([['src/main.js', { imports: ['./missing'] }]]);
  const result = resolveImportLinks({
    root: tempRoot,
    entries,
    importsByFile,
    fileRelations: relations,
    enableGraph: false,
    cache,
    fileHashes,
    resolverPlugins
  });
  const unresolvedSamples = enrichUnresolvedImportSamples(result.unresolvedSamples || []);
  const unresolvedTaxonomy = {
    ...summarizeUnresolvedImportTaxonomy(unresolvedSamples),
    resolverBudgetExhausted: result?.stats?.unresolvedBudgetExhausted || 0,
    resolverBudgetExhaustedByType: result?.stats?.unresolvedBudgetExhaustedByType || {}
  };
  const diagnostics = updateImportResolutionDiagnosticsCache({
    cache,
    unresolvedTaxonomy,
    unresolvedTotal: result?.stats?.unresolved
  });
  await saveImportResolutionCache({ cache, cachePath });
  return diagnostics;
};

const budgetPlugins = {
  budgets: {
    maxFilesystemProbesPerSpecifier: 0,
    maxFallbackCandidatesPerSpecifier: 8
  }
};

const first = await runResolution(budgetPlugins);
assert.equal(first?.unresolvedTrend?.current?.resolverBudgetExhausted, 1);
assert.deepEqual(
  Object.fromEntries(Object.entries(first?.unresolvedTrend?.current?.resolverBudgetExhaustedByType || {})),
  { filesystem_probe: 1 }
);
assert.equal(first?.unresolvedTrend?.deltaResolverBudgetExhausted, 1);
assert.deepEqual(
  Object.fromEntries(Object.entries(first?.unresolvedTrend?.deltaResolverBudgetExhaustedByType || {})),
  { filesystem_probe: 1 }
);

const second = await runResolution(budgetPlugins);
assert.equal(second?.unresolvedTrend?.current?.resolverBudgetExhausted, 1);
assert.equal(second?.unresolvedTrend?.deltaResolverBudgetExhausted, 0);
assert.deepEqual(
  Object.fromEntries(Object.entries(second?.unresolvedTrend?.deltaResolverBudgetExhaustedByType || {})),
  { filesystem_probe: 0 }
);

const third = await runResolution(null);
assert.equal(third?.unresolvedTrend?.current?.resolverBudgetExhausted, 0);
assert.equal(third?.unresolvedTrend?.deltaResolverBudgetExhausted, -1);
assert.deepEqual(
  Object.fromEntries(Object.entries(third?.unresolvedTrend?.deltaResolverBudgetExhaustedByType || {})),
  { filesystem_probe: -1 }
);

console.log('import graph budget diagnostics test passed');
