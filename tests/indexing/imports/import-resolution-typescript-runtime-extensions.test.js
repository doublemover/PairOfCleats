#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';
import { createFsExistsIndex } from '../../../src/index/build/import-resolution/fs-exists-index.js';
import { applyImportResolutionCacheFileSetDiffInvalidation } from '../../../src/index/build/import-resolution-cache.js';
import { createImportResolutionCacheStats, createImportResolutionTempRoot } from '../../helpers/import-resolution-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const root = await createImportResolutionTempRoot('import-resolution-typescript-runtime-extensions');
const importer = 'apps/server/src/app.ts';
const write = async (rel, content = 'export {};\n') => {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content);
};
const files = [
  importer, 'apps/server/src/config.ts', 'apps/server/src/logger.tsx',
  'apps/server/src/http/register-http-routes.ts', 'apps/server/src/esm.mts',
  'apps/server/src/common.cts', 'apps/server/src/types.d.ts',
  'apps/server/src/esm-types.d.mts', 'apps/server/src/common-types.d.cts',
  'apps/server/src/dupe.js', 'apps/server/src/dupe.ts',
  'apps/server/src/directory/index.ts', 'apps/server/src/wrong-format.ts', 'tsconfig.json'
];
for (const file of files) await write(file);
await write('tsconfig.json', JSON.stringify({ compilerOptions: {
  baseUrl: '.', paths: { '@server/*': ['apps/server/src/*'] }
} }));
const entries = files.map((rel) => ({ rel, abs: path.join(root, rel) }));
const run = (specs, options = {}) => {
  const relations = new Map([[importer, { imports: specs }]]);
  const result = resolveImportLinks({
    root, entries, importsByFile: { [importer]: specs }, fileRelations: relations,
    enableGraph: true, ...options
  });
  return { result, relation: relations.get(importer) };
};

const specs = [
  './config.js', './logger.js', './http/register-http-routes.js', './esm.mjs',
  './common.cjs', './types.js', './esm-types.mjs', './common-types.cjs', './dupe.js'
];
const indexed = run(specs, { resolverPlugins: { budgets: {
  maxFilesystemProbesPerSpecifier: 0, maxFallbackCandidatesPerSpecifier: 0
} } });
assert.deepEqual(indexed.relation.importLinks, files.filter((rel) => (
  rel !== importer && rel !== 'tsconfig.json' && !rel.endsWith('/dupe.ts')
  && !rel.endsWith('/directory/index.ts') && !rel.endsWith('/wrong-format.ts')
)).sort());
assert.equal(indexed.result.stats.unresolved, 0);
assert.equal(indexed.result.stats.resolverPipelineStages.filesystem_probe?.attempts || 0, 0,
  'indexed source counterparts must resolve without spending fallback budgets');

const mapped = run(['@server/config.js', 'alias/logger.js'], { resolverPlugins: {
  alias: { alias: 'apps/server/src' }
} });
assert.deepEqual(mapped.relation.importLinks, ['apps/server/src/config.ts', 'apps/server/src/logger.tsx']);
const normalized = run(['.\\http\\register-http-routes.js', './config.js?raw']);
assert.deepEqual(normalized.relation.importLinks, [
  'apps/server/src/config.ts', 'apps/server/src/http/register-http-routes.ts'
]);
assert.deepEqual(run(['./esm-types', './common-types']).relation.importLinks, [
  'apps/server/src/common-types.d.cts', 'apps/server/src/esm-types.d.mts'
], 'compound declaration extensions must retain the correct trie stem');

const missing = run(['./missing.js', './directory.js', './wrong-format.mjs']);
assert.equal(missing.result.stats.unresolved, 3);
assert.ok(missing.result.unresolvedSamples.every((sample) => sample.reasonCode === 'IMP_U_MISSING_FILE_RELATIVE'));

// Existing non-indexed source files keep the existing external classification.
// A partial existence index must fall back to bounded filesystem probes.
await write('apps/server/src/non-indexed.ts');
const partialIndex = await createFsExistsIndex({ root, entries, resolverPlugins: {
  fsExistsIndex: { maxScanFiles: 1, dirConcurrency: 1 }
} });
assert.equal(partialIndex.complete, false);
const partial = run(['./non-indexed.js'], { fsExistsIndex: partialIndex });
assert.deepEqual(partial.relation.externalImports, ['./non-indexed.js']);
assert.deepEqual(partial.relation.importLinks, []);
assert.ok(partial.result.stats.resolverFsExistsIndex.unknownFallbacks > 0);
assert.equal(partial.result.stats.unresolved, 0);

const exhausted = run(['./non-indexed.js'], { fsExistsIndex: partialIndex, resolverPlugins: { budgets: {
  maxFilesystemProbesPerSpecifier: 1, maxFallbackCandidatesPerSpecifier: 4
} } });
assert.equal(exhausted.result.stats.unresolvedBudgetExhausted, 1);
assert.equal(exhausted.result.unresolvedSamples[0].reasonCode, 'IMP_U_RESOLVER_BUDGET_EXHAUSTED');
const completeIndex = await createFsExistsIndex({ root, entries });
const accelerated = run(['./non-indexed.js'], { fsExistsIndex: completeIndex, resolverPlugins: { budgets: {
  maxFilesystemProbesPerSpecifier: 0, maxFallbackCandidatesPerSpecifier: 4
} } });
assert.deepEqual(accelerated.relation.externalImports, ['./non-indexed.js']);
assert.equal(accelerated.result.stats.resolverFsExistsIndex.exactHits, 1);
assert.equal(accelerated.result.stats.resolverFsExistsIndex.negativeSkips, 1);

// Budgets are reset per specifier: missing files cannot starve later lookups.
const pressure = run(['./missing.js', './non-indexed.js', './config.js'], {
  fsExistsIndex: partialIndex,
  resolverPlugins: { budgets: {
    maxFilesystemProbesPerSpecifier: 2, maxFallbackCandidatesPerSpecifier: 4
  } }
});
assert.deepEqual(pressure.relation.importLinks, ['apps/server/src/config.ts']);
assert.deepEqual(pressure.relation.externalImports, ['./non-indexed.js']);
assert.equal(pressure.result.stats.unresolvedBudgetExhausted, 1);

// Invalidate stale missing-file decisions when their source counterpart is
// added, then retain exact-file precedence if a literal runtime file appears.
for (const [runtimeExt, sourceExt] of [['.js', '.ts'], ['.mjs', '.mts'], ['.cjs', '.cts']]) {
  const spec = `./later${runtimeExt}`;
  const source = `apps/server/src/later${sourceExt}`;
  const literal = `apps/server/src/later${runtimeExt}`;
  const cache = {};
  const fileHashes = new Map([[importer, 'unchanged-importer']]);
  const first = run([spec], { cache, fileHashes });
  assert.equal(first.result.stats.unresolved, 1);
  await write(source);
  const nextEntries = [...entries, { rel: source, abs: path.join(root, source) }];
  const cacheStats = createImportResolutionCacheStats();
  applyImportResolutionCacheFileSetDiffInvalidation({ cache, entries: nextEntries, cacheStats });
  assert.equal(cacheStats.staleEdgeInvalidated, 1, 'source additions must invalidate unresolved runtime specifiers');
  const second = run([spec], { cache, fileHashes, entries: nextEntries });
  assert.deepEqual(second.relation.importLinks, [source]);
  const warm = run([spec], { cache, fileHashes, entries: nextEntries });
  assert.deepEqual(warm.relation.importLinks, [source]);
  assert.equal(warm.result.cacheStats.filesReused, 1);
  cache.files[importer].resolverScopeFingerprint = 'pre-runtime-extension-fix';
  const stale = run([spec], { cache, fileHashes, entries: nextEntries });
  assert.equal(stale.result.cacheStats.filesReused, 0, 'old resolver scope must not replay prior decisions');
  assert.deepEqual(stale.relation.importLinks, [source]);
  await write(literal);
  const literalEntries = [...nextEntries, { rel: literal, abs: path.join(root, literal) }];
  applyImportResolutionCacheFileSetDiffInvalidation({ cache, entries: literalEntries });
  const third = run([spec], { cache, fileHashes, entries: literalEntries });
  assert.deepEqual(third.relation.importLinks, [literal]);
}

console.log('TypeScript runtime-extension import resolution test passed');
