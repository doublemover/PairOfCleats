#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';
import {
  applyImportResolutionCacheFileSetDiffInvalidation,
  loadImportResolutionCache,
  saveImportResolutionCache,
  updateImportResolutionDiagnosticsCache
} from '../../../src/index/build/import-resolution-cache.js';
import {
  enrichUnresolvedImportSamples,
  summarizeUnresolvedImportTaxonomy
} from '../../../src/index/build/imports.js';
import { mergeImportGraphWarnings } from '../../../src/index/build/indexer/steps/relations/import-scan.js';
import { sha1 } from '../../../src/shared/hash.js';
import {
  createImportResolutionCacheStats,
  createImportResolutionTempRoot
} from '../../helpers/import-resolution-fixture.js';

const buildManifestFiles = (fileHashes) => (
  Object.fromEntries(Array.from(fileHashes.entries()).map(([rel, hash]) => [rel, { hash }]))
);

const createImportRefreshFixture = async (name) => {
  const tempRoot = await createImportResolutionTempRoot(name);
  const srcRoot = path.join(tempRoot, 'src');
  const incrementalDir = path.join(tempRoot, '.incremental');
  const fileHashes = new Map();
  const writeFile = async (rel, content) => {
    const abs = path.join(tempRoot, rel);
    await fs.writeFile(abs, content, 'utf8');
    fileHashes.set(rel.replace(/\\/g, '/'), sha1(content));
  };
  const createEntry = (rel) => ({
    abs: path.join(tempRoot, rel),
    rel
  });
  const createIncrementalState = () => ({
    enabled: true,
    incrementalDir,
    manifest: {
      files: buildManifestFiles(fileHashes)
    }
  });
  const refreshIncrementalManifest = (incrementalState) => {
    incrementalState.manifest.files = buildManifestFiles(fileHashes);
  };

  await fs.mkdir(srcRoot, { recursive: true });
  await fs.mkdir(incrementalDir, { recursive: true });
  return {
    tempRoot,
    srcRoot,
    incrementalDir,
    fileHashes,
    writeFile,
    createEntry,
    createIncrementalState,
    refreshIncrementalManifest,
    manifestFiles: () => buildManifestFiles(fileHashes)
  };
};

const cases = [
  {
    name: 'resolved links refresh when a previously-resolved target disappears',
    async run() {
      const {
        tempRoot,
        fileHashes,
        writeFile,
        createEntry,
        createIncrementalState,
        refreshIncrementalManifest
      } = await createImportRefreshFixture('imports-graph-resolved-refresh');

      await writeFile('src/main.js', "import './util';\n");
      await writeFile('src/util.js', 'export const ok = true;\n');
      await writeFile('package.json', '{"name":"import-graph-resolved-refresh"}\n');

      const importsByFile = {
        'src/main.js': ['./util']
      };
      const incrementalState = createIncrementalState();
      const runResolution = async (entries) => {
        const { cache, cachePath } = await loadImportResolutionCache({ incrementalState });
        const relations = new Map([['src/main.js', { imports: ['./util'] }]]);
        resolveImportLinks({
          root: tempRoot,
          entries,
          importsByFile,
          fileRelations: relations,
          enableGraph: false,
          cache,
          fileHashes
        });
        await saveImportResolutionCache({ cache, cachePath });
        return relations.get('src/main.js')?.importLinks || [];
      };

      assert.deepEqual(
        await runResolution([
          createEntry('src/main.js'),
          createEntry('src/util.js')
        ]),
        ['src/util.js']
      );

      await fs.rm(path.join(tempRoot, 'src/util.js'));
      fileHashes.delete('src/util.js');
      refreshIncrementalManifest(incrementalState);

      assert.deepEqual(
        await runResolution([createEntry('src/main.js')]),
        []
      );
    }
  },
  {
    name: 'unresolved taxonomy diagnostics refresh when missing files appear',
    async run() {
      const {
        tempRoot,
        fileHashes,
        writeFile,
        createEntry,
        createIncrementalState,
        refreshIncrementalManifest
      } = await createImportRefreshFixture('imports-graph-unresolved-refresh');

      await writeFile('src/main.js', "import './missing';\n");
      await writeFile('package.json', '{"name":"import-graph-unresolved-refresh"}\n');

      const incrementalState = createIncrementalState();
      const importsByFile = {
        'src/main.js': ['./missing']
      };
      const runResolution = async (entries) => {
        const { cache, cachePath } = await loadImportResolutionCache({ incrementalState });
        const cacheStats = createImportResolutionCacheStats();
        applyImportResolutionCacheFileSetDiffInvalidation({ cache, entries, cacheStats });
        const relations = new Map([['src/main.js', { imports: ['./missing'] }]]);
        const result = resolveImportLinks({
          root: tempRoot,
          entries,
          importsByFile,
          fileRelations: relations,
          enableGraph: false,
          cache,
          fileHashes,
          cacheStats
        });
        const unresolvedSamples = enrichUnresolvedImportSamples(result.unresolvedSamples || []);
        const unresolvedTaxonomy = summarizeUnresolvedImportTaxonomy(unresolvedSamples);
        const diagnostics = updateImportResolutionDiagnosticsCache({
          cache,
          unresolvedTaxonomy,
          unresolvedTotal: result?.stats?.unresolved
        });
        await saveImportResolutionCache({ cache, cachePath });
        return {
          links: relations.get('src/main.js')?.importLinks || [],
          diagnostics
        };
      };

      const first = await runResolution([createEntry('src/main.js')]);
      assert.deepEqual(first.links, []);
      assert.equal(first.diagnostics?.unresolvedTrend?.current?.total, 1);

      await writeFile('src/missing.js', 'export const ok = true;\n');
      refreshIncrementalManifest(incrementalState);

      const second = await runResolution([
        createEntry('src/main.js'),
        createEntry('src/missing.js')
      ]);
      assert.deepEqual(second.links, ['src/missing.js']);
      assert.equal(second.diagnostics?.unresolvedTrend?.current?.total, 0);
      assert.equal(second.diagnostics?.unresolvedTrend?.deltaTotal, -1);
    }
  },
  {
    name: 'warning merge preserves existing graph warnings and dedupes scan warnings',
    async run() {
      const existingWarnings = [
        {
          importer: 'src/main.js',
          specifier: './missing.js',
          reasonCode: 'IMP_U_MISSING_FILE_RELATIVE',
          reason: 'missing file',
          source: 'graph'
        },
        {
          importer: 'src/legacy.js',
          specifier: 'legacy-pkg',
          reasonCode: 'IMP_U_UNKNOWN',
          reason: 'legacy unresolved',
          source: 'graph'
        }
      ];
      const unresolvedSamples = [
        {
          importer: 'src/main.js',
          specifier: './missing.js',
          reasonCode: 'IMP_U_MISSING_FILE_RELATIVE',
          reason: 'missing file',
          source: 'scan'
        },
        {
          importer: 'src/extra.js',
          specifier: './missing2.js',
          reasonCode: 'IMP_U_MISSING_FILE_RELATIVE',
          reason: 'missing file',
          source: 'scan'
        }
      ];

      const mergedWarnings = mergeImportGraphWarnings({
        existingWarnings,
        unresolvedSamples
      });
      assert.equal(mergedWarnings.length, 3);
      assert.deepEqual(mergedWarnings.map((warning) => warning.importer), ['src/main.js', 'src/legacy.js', 'src/extra.js']);
      assert.equal(mergedWarnings[0].source, 'graph');
      assert.equal(mergedWarnings[2].source, 'scan');
    }
  },
  {
    name: 'resolver budget diagnostics track exhaustion deltas by stage',
    async run() {
      const {
        tempRoot,
        fileHashes,
        writeFile,
        createEntry,
        createIncrementalState
      } = await createImportRefreshFixture('imports-graph-budget-diagnostics');
      await writeFile('src/main.js', "import './missing';\n");
      await writeFile('package.json', '{"name":"import-graph-budget-diagnostics"}\n');

      const incrementalState = createIncrementalState();
      const entries = [createEntry('src/main.js')];
      const importsByFile = { 'src/main.js': ['./missing'] };
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
      assert.deepEqual(Object.fromEntries(Object.entries(first?.unresolvedTrend?.current?.resolverBudgetExhaustedByType || {})), { filesystem_probe: 1 });

      const second = await runResolution(budgetPlugins);
      assert.equal(second?.unresolvedTrend?.deltaResolverBudgetExhausted, 0);

      const third = await runResolution(null);
      assert.equal(third?.unresolvedTrend?.current?.resolverBudgetExhausted, 0);
      assert.equal(third?.unresolvedTrend?.deltaResolverBudgetExhausted, -1);
    }
  }
];

for (const entry of cases) {
  await entry.run();
}

console.log('import graph contract matrix test passed');
