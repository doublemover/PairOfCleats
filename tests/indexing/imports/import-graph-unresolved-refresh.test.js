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
const tempRoot = resolveTestCachePath(root, 'import-graph-unresolved-refresh');
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
  const unresolvedSamples = enrichUnresolvedImportSamples(result.unresolvedSamples || []);
  const unresolvedTaxonomy = summarizeUnresolvedImportTaxonomy(unresolvedSamples);
  const cacheDiagnostics = updateImportResolutionDiagnosticsCache({
    cache,
    unresolvedTaxonomy,
    unresolvedTotal: result?.stats?.unresolved
  });
  await saveImportResolutionCache({ cache, cachePath });
  return {
    relations,
    cacheStats: result.cacheStats,
    unresolvedTaxonomy,
    cacheDiagnostics
  };
};

const entriesInitial = [
  { abs: path.join(srcRoot, 'main.js'), rel: 'src/main.js' }
];

const first = await runResolution(entriesInitial);
const firstLinks = first.relations.get('src/main.js')?.importLinks || [];
assert.equal(firstLinks.length, 0, 'expected unresolved import to remain empty');
assert.equal(first.unresolvedTaxonomy.total, 1, 'expected unresolved taxonomy total to capture unresolved import');
assert.equal(first.cacheDiagnostics?.unresolvedTrend?.previous, null);
assert.equal(first.cacheDiagnostics?.unresolvedTrend?.current?.total, 1);
assert.equal(first.cacheDiagnostics?.unresolvedTrend?.current?.actionableRate, 1);
assert.equal(first.cacheDiagnostics?.unresolvedTrend?.current?.parserArtifactRate, 0);
assert.equal(first.cacheDiagnostics?.unresolvedTrend?.current?.resolverGapRate, 0);
assert.equal(first.cacheDiagnostics?.unresolvedTrend?.deltaActionableRate, null);
assert.equal(first.cacheDiagnostics?.unresolvedTrend?.deltaParserArtifactRate, null);
assert.equal(first.cacheDiagnostics?.unresolvedTrend?.deltaResolverGapRate, null);
assert.deepEqual(
  Object.fromEntries(Object.entries(first.cacheDiagnostics?.unresolvedTrend?.current?.failureCauses || {})),
  { missing_file: 1 }
);
assert.deepEqual(
  Object.fromEntries(Object.entries(first.cacheDiagnostics?.unresolvedTrend?.current?.resolverStages || {})),
  { filesystem_probe: 1 }
);
assert.deepEqual(
  first.cacheDiagnostics?.unresolvedTrend?.current?.actionableHotspots || [],
  [{ importer: 'src/main.js', count: 1 }]
);
assert.deepEqual(
  Object.fromEntries(Object.entries(first.cacheDiagnostics?.unresolvedTrend?.current?.actionableByLanguage || {})),
  { js: 1 }
);

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
assert.equal(second.unresolvedTaxonomy.total, 0, 'expected unresolved taxonomy to clear after file is added');
assert.equal(second.cacheDiagnostics?.unresolvedTrend?.previous?.total, 1);
assert.equal(second.cacheDiagnostics?.unresolvedTrend?.current?.total, 0);
assert.equal(second.cacheDiagnostics?.unresolvedTrend?.deltaTotal, -1);
assert.equal(second.cacheDiagnostics?.unresolvedTrend?.current?.actionableRate, 0);
assert.equal(second.cacheDiagnostics?.unresolvedTrend?.current?.parserArtifactRate, 0);
assert.equal(second.cacheDiagnostics?.unresolvedTrend?.current?.resolverGapRate, 0);
assert.equal(second.cacheDiagnostics?.unresolvedTrend?.deltaActionableRate, -1);
assert.equal(second.cacheDiagnostics?.unresolvedTrend?.deltaParserArtifactRate, 0);
assert.equal(second.cacheDiagnostics?.unresolvedTrend?.deltaResolverGapRate, 0);
assert.deepEqual(
  Object.fromEntries(Object.entries(second.cacheDiagnostics?.unresolvedTrend?.deltaByFailureCause || {})),
  { missing_file: -1 }
);
assert.deepEqual(
  Object.fromEntries(Object.entries(second.cacheDiagnostics?.unresolvedTrend?.deltaByResolverStage || {})),
  { filesystem_probe: -1 }
);
assert.deepEqual(
  Object.fromEntries(Object.entries(second.cacheDiagnostics?.unresolvedTrend?.deltaByActionableLanguage || {})),
  { js: -1 }
);
assert.deepEqual(
  second.cacheDiagnostics?.unresolvedTrend?.current?.actionableHotspots || [],
  []
);
assert.deepEqual(
  Object.fromEntries(Object.entries(second.cacheDiagnostics?.unresolvedTrend?.current?.actionableByLanguage || {})),
  {}
);

const { cache: persistedCache } = await loadImportResolutionCache({ incrementalState });
assert.equal(persistedCache?.diagnostics?.unresolvedTrend?.current?.total, 0);
assert.equal(persistedCache?.diagnostics?.unresolvedTrend?.previous?.total, 1);
assert.equal(persistedCache?.diagnostics?.unresolvedTrend?.deltaTotal, -1);

console.log('import graph unresolved refresh test passed');
