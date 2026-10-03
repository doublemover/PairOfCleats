#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';
import { scanImports } from '../../../src/index/build/imports.js';
import { readCachedImports } from '../../../src/index/build/incremental.js';
import {
  applyImportResolutionCacheFileSetDiffInvalidation,
  loadImportResolutionCache,
  saveImportResolutionCache
} from '../../../src/index/build/import-resolution-cache.js';
import { resolveBundleFilename } from '../../../src/shared/bundle-io-paths.js';
import { writeBundleFile } from '../../../src/shared/bundle-io.js';
import { sha1 } from '../../../src/shared/hash.js';
import {
  createImportResolutionCacheStats,
  createImportResolutionTempRoot
} from '../../helpers/import-resolution-fixture.js';

const cases = [
  {
    name: 'collector hints are emitted for direct scans',
    async run() {
      const tempRoot = await createImportResolutionTempRoot('imports-contract-collector-hints');
      await fs.mkdir(path.join(tempRoot, 'repo'), { recursive: true });
      const starlarkPath = path.join(tempRoot, 'repo', 'MODULE.bazel');
      const nixPath = path.join(tempRoot, 'repo', 'flake.nix');
      await fs.writeFile(starlarkPath, 'load("//tools:deps.bzl", "deps")\n', 'utf8');
      await fs.writeFile(nixPath, 'inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";\n', 'utf8');

      const result = await scanImports({
        files: [
          { abs: starlarkPath, rel: 'repo/MODULE.bazel', stat: await fs.stat(starlarkPath) },
          { abs: nixPath, rel: 'repo/flake.nix', stat: await fs.stat(nixPath) }
        ],
        root: tempRoot,
        mode: 'code',
        languageOptions: {},
        importConcurrency: 1
      });

      assert.deepEqual(result.importsByFile['repo/MODULE.bazel'] || [], ['//tools:deps.bzl']);
      assert.deepEqual(result.importsByFile['repo/flake.nix'] || [], ['github:NixOS/nixpkgs/nixos-24.11']);
      assert.equal(result.importHintsByFile?.['repo/MODULE.bazel']?.['//tools:deps.bzl']?.reasonCode, 'IMP_U_RESOLVER_GAP');
      assert.equal(result.importHintsByFile?.['repo/flake.nix']?.['github:NixOS/nixpkgs/nixos-24.11']?.reasonCode, 'IMP_U_RESOLVER_GAP');
    }
  },
  {
    name: 'cached scan entries preserve hints and rebuild legacy hint-less entries',
    async run() {
      const tempRoot = await createImportResolutionTempRoot('imports-contract-cache-hints');
      await fs.mkdir(path.join(tempRoot, 'repo'), { recursive: true });

      const cachedHintPath = path.join(tempRoot, 'repo', 'MODULE.bazel');
      const rebuiltHintPath = path.join(tempRoot, 'repo', 'flake.nix');
      await fs.writeFile(cachedHintPath, 'load("//tools:deps.bzl", "deps")\n', 'utf8');
      await fs.writeFile(rebuiltHintPath, 'inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";\n', 'utf8');

      const cachedResponses = new Map([
        ['repo/MODULE.bazel', [
          {
            specifier: '//tools:deps.bzl',
            collectorHint: {
              reasonCode: 'IMP_U_RESOLVER_GAP',
              confidence: 0.95,
              detail: 'cached collector hint'
            }
          }
        ]],
        ['repo/flake.nix', ['github:NixOS/nixpkgs/nixos-24.11']]
      ]);

      const result = await scanImports({
        files: [
          { abs: cachedHintPath, rel: 'repo/MODULE.bazel', stat: await fs.stat(cachedHintPath) },
          { abs: rebuiltHintPath, rel: 'repo/flake.nix', stat: await fs.stat(rebuiltHintPath) }
        ],
        root: tempRoot,
        mode: 'code',
        languageOptions: {},
        importConcurrency: 1,
        incrementalState: {
          enabled: true,
          manifest: { files: {} },
          bundleDir: tempRoot,
          bundleFormat: 'json'
        },
        readCachedImportsFn: async ({ relKey }) => cachedResponses.get(relKey) ?? null
      });

      assert.equal(result.importHintsByFile?.['repo/MODULE.bazel']?.['//tools:deps.bzl']?.reasonCode, 'IMP_U_RESOLVER_GAP');
      assert.equal(result.importHintsByFile?.['repo/flake.nix']?.['github:NixOS/nixpkgs/nixos-24.11']?.reasonCode, 'IMP_U_RESOLVER_GAP');
    }
  },
  {
    name: 'incremental scans read cached imports once per file',
    async run() {
      const tempRoot = await createImportResolutionTempRoot('imports-contract-cache-read');
      const srcRoot = path.join(tempRoot, 'src');
      await fs.mkdir(srcRoot, { recursive: true });

      const files = [];
      for (const name of ['a.js', 'b.js']) {
        const filePath = path.join(srcRoot, name);
        await fs.writeFile(filePath, 'export const value = 1;\n', 'utf8');
        files.push({ abs: filePath, rel: `src/${name}`, stat: await fs.stat(filePath) });
      }

      let calls = 0;
      await scanImports({
        files,
        root: tempRoot,
        mode: 'code',
        languageOptions: {},
        importConcurrency: 1,
        incrementalState: {
          enabled: true,
          manifest: { files: {} },
          bundleDir: tempRoot,
          bundleFormat: 'json'
        },
        readCachedImportsFn: async () => {
          calls += 1;
          return null;
        }
      });

      assert.equal(calls, files.length);
    }
  },
  {
    name: 'file-set invalidation clears stale resolved and unresolved edges',
    async run() {
      const tempRoot = await createImportResolutionTempRoot('imports-contract-file-set-invalidation');
      const srcRoot = path.join(tempRoot, 'src');
      await fs.mkdir(srcRoot, { recursive: true });
      await fs.writeFile(path.join(srcRoot, 'main.js'), "import './later.js';\n", 'utf8');

      const importsByFile = {
        'src/main.js': ['./later.js']
      };
      const fileHashes = new Map([['src/main.js', 'hash-main']]);
      const cache = {};
      const buildEntries = (includeLater) => {
        const entries = [{ abs: path.join(srcRoot, 'main.js'), rel: 'src/main.js' }];
        if (includeLater) {
          entries.push({ abs: path.join(srcRoot, 'later.js'), rel: 'src/later.js' });
        }
        return entries;
      };
      const buildRelations = () => new Map([['src/main.js', { imports: ['./later.js'] }]]);
      const runOnce = ({ entries, stats }) => {
        const relations = buildRelations();
        applyImportResolutionCacheFileSetDiffInvalidation({ cache, entries, cacheStats: stats });
        resolveImportLinks({
          root: tempRoot,
          entries,
          importsByFile,
          fileRelations: relations,
          enableGraph: false,
          cache,
          cacheStats: stats,
          fileHashes,
          mode: 'code'
        });
        return relations.get('src/main.js');
      };

      const firstStats = createImportResolutionCacheStats();
      const first = runOnce({ entries: buildEntries(false), stats: firstStats });
      assert.deepEqual(first.importLinks, []);
      assert.equal(firstStats.fileSetInvalidated, true);

      await fs.writeFile(path.join(srcRoot, 'later.js'), 'export const later = 1;\n', 'utf8');
      const secondStats = createImportResolutionCacheStats();
      const second = runOnce({ entries: buildEntries(true), stats: secondStats });
      assert.deepEqual(second.importLinks, ['src/later.js']);
      assert.equal(secondStats.fileSetInvalidated, true);
      assert.ok((secondStats.staleEdgeInvalidated || 0) >= 1);

      await fs.rm(path.join(srcRoot, 'later.js'));
      const thirdStats = createImportResolutionCacheStats();
      const third = runOnce({ entries: buildEntries(false), stats: thirdStats });
      assert.deepEqual(third.importLinks, []);
      assert.equal(thirdStats.fileSetInvalidated, true);
      assert.ok((thirdStats.filesNeighborhoodInvalidated || 0) >= 1);
    }
  },
  {
    name: 'removed resolved targets invalidate cached links when files disappear',
    async run() {
      const tempRoot = await createImportResolutionTempRoot('imports-contract-missing-file-refresh');
      const srcRoot = path.join(tempRoot, 'src');
      await fs.mkdir(srcRoot, { recursive: true });
      await fs.writeFile(path.join(srcRoot, 'main.js'), "import './target.js';\n", 'utf8');
      await fs.writeFile(path.join(srcRoot, 'target.js'), 'export const target = 1;\n', 'utf8');

      const importsByFile = {
        'src/main.js': ['./target.js']
      };
      const fileHashes = new Map([['src/main.js', 'hash-main']]);
      const cache = {};
      const buildRelations = () => new Map([['src/main.js', { imports: ['./target.js'] }]]);
      const runOnce = (entries, stats) => {
        const relations = buildRelations();
        applyImportResolutionCacheFileSetDiffInvalidation({ cache, entries, cacheStats: stats });
        resolveImportLinks({
          root: tempRoot,
          entries,
          importsByFile,
          fileRelations: relations,
          enableGraph: false,
          cache,
          cacheStats: stats,
          fileHashes,
          mode: 'code'
        });
        return relations.get('src/main.js');
      };

      const initialStats = createImportResolutionCacheStats();
      const first = runOnce([
        { abs: path.join(srcRoot, 'main.js'), rel: 'src/main.js' },
        { abs: path.join(srcRoot, 'target.js'), rel: 'src/target.js' }
      ], initialStats);
      assert.deepEqual(first.importLinks, ['src/target.js']);

      await fs.rm(path.join(srcRoot, 'target.js'));
      const secondStats = createImportResolutionCacheStats();
      const second = runOnce([{ abs: path.join(srcRoot, 'main.js'), rel: 'src/main.js' }], secondStats);
      assert.deepEqual(second.importLinks, []);
      assert.equal(secondStats.fileSetInvalidated, true);
      assert.ok((secondStats.filesNeighborhoodInvalidated || 0) >= 1);
    }
  },
  {
    name: 'incompatible and malformed cache files fail closed or reset safely',
    async run() {
      const tempRoot = await createImportResolutionTempRoot('imports-contract-hard-cutover');
      const incrementalDir = path.join(tempRoot, 'incremental');
      const cachePath = path.join(incrementalDir, 'import-resolution-cache.json');
      await fs.mkdir(incrementalDir, { recursive: true });

      const logs = [];
      const log = (message) => logs.push(String(message || ''));

      await fs.writeFile(cachePath, JSON.stringify({ version: 4 }, null, 2), 'utf8');
      await assert.rejects(
        () => loadImportResolutionCache({
          incrementalState: { incrementalDir },
          log
        }),
        (error) => error?.code === 'ERR_IMPORT_RESOLUTION_CACHE_INCOMPATIBLE'
      );
      assert.equal(logs.some((entry) => entry.includes('incompatible import resolution cache version')), true);

      await fs.writeFile(cachePath, '{', 'utf8');
      const malformedLoad = await loadImportResolutionCache({
        incrementalState: { incrementalDir },
        log
      });
      assert.equal(malformedLoad.cache?.version > 0, true);
      assert.equal(logs.some((entry) => entry.includes('Failed to read import resolution cache')), true);

      await fs.writeFile(cachePath, JSON.stringify({
        version: malformedLoad.cache.version,
        diagnostics: {
          version: 4,
          unresolvedTrend: {
            previous: null,
            current: {
              total: 1,
              actionable: 1,
              liveSuppressed: 0,
              gateSuppressed: 0,
              reasonCodes: { IMP_U_NOT_REAL: 1 },
              failureCauses: { missing_file: 1 },
              dispositions: { actionable: 1 },
              resolverStages: { filesystem_probe: 1 },
              resolverBudgetExhausted: 0,
              resolverBudgetExhaustedByType: {},
              actionableHotspots: [],
              actionableRate: 1
            },
            deltaTotal: 1,
            deltaByReasonCode: { IMP_U_NOT_REAL: 1 },
            deltaByFailureCause: { missing_file: 1 },
            deltaByDisposition: { actionable: 1 },
            deltaByResolverStage: { filesystem_probe: 1 },
            deltaResolverBudgetExhausted: 0,
            deltaResolverBudgetExhaustedByType: {}
          }
        }
      }, null, 2), 'utf8');
      await assert.rejects(
        () => loadImportResolutionCache({
          incrementalState: { incrementalDir },
          log
        }),
        (error) => error?.code === 'ERR_IMPORT_RESOLUTION_CACHE_INCOMPATIBLE'
          && String(error?.message || '').includes('Unknown reasonCode keys: IMP_U_NOT_REAL')
      );

      await saveImportResolutionCache({
        cache: malformedLoad.cache,
        cachePath: malformedLoad.cachePath
      });
      const reloaded = await loadImportResolutionCache({
        incrementalState: { incrementalDir },
        log
      });
      assert.deepEqual(reloaded.cache?.files, {});
    }
  },
  {
    name: 'import scan fingerprints gate cache reuse while ignoring runtime-only options',
    async run() {
      const tempRoot = await createImportResolutionTempRoot('imports-contract-budget-cache-key');
      const repoRoot = path.join(tempRoot, 'repo');
      const filePath = path.join(repoRoot, 'src', 'main.ts');
      const relKey = 'src/main.ts';
      const source = "import './client.codegen.ts';\n";

      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, source, 'utf8');

      const stat = await fs.stat(filePath);
      const fileHash = sha1(source);
      const bundleDir = path.join(tempRoot, 'bundles');
      await fs.mkdir(bundleDir, { recursive: true });
      const bundleName = resolveBundleFilename(relKey, 'json');
      const bundlePath = path.join(bundleDir, bundleName);
      const matchingFingerprint = 'matching-scan-fingerprint';

      await writeBundleFile({
        bundlePath,
        format: 'json',
        bundle: {
          file: relKey,
          hash: fileHash,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          chunks: [],
          fileRelations: {
            imports: ['./client.codegen.ts'],
            importScanFingerprint: matchingFingerprint
          }
        }
      });

      const manifest = {
        bundleFormat: 'json',
        files: {
          [relKey]: {
            hash: fileHash,
            mtimeMs: stat.mtimeMs,
            size: stat.size,
            bundle: bundleName
          }
        }
      };

      const matched = await readCachedImports({
        enabled: true,
        absPath: filePath,
        relKey,
        fileStat: stat,
        manifest,
        bundleDir,
        bundleFormat: 'json',
        expectedImportScanFingerprint: matchingFingerprint
      });
      assert.deepEqual(matched, ['./client.codegen.ts']);

      const mismatched = await readCachedImports({
        enabled: true,
        absPath: filePath,
        relKey,
        fileStat: stat,
        manifest,
        bundleDir,
        bundleFormat: 'json',
        expectedImportScanFingerprint: 'different-fingerprint'
      });
      assert.equal(mismatched, null);

      const scanResult = await scanImports({
        files: [{ abs: filePath, rel: relKey, stat }],
        root: repoRoot,
        mode: 'code',
        languageOptions: {
          collectorScanBudget: { maxChars: 128 }
        },
        importConcurrency: 1,
        incrementalState: {
          enabled: true,
          manifest,
          bundleDir,
          bundleFormat: 'json'
        },
        readCachedImportsFn: readCachedImports
      });
      assert.equal(typeof scanResult.importScanFingerprint, 'string');
      assert.deepEqual(scanResult.importsByFile[relKey] || [], ['./client.codegen.ts']);

      const fingerprintVariant = await scanImports({
        files: [{ abs: filePath, rel: relKey, stat }],
        root: repoRoot,
        mode: 'code',
        languageOptions: {
          collectorScanBudget: { maxChars: 128 },
          customCollectorOption: 'variant'
        },
        importConcurrency: 1,
        incrementalState: { enabled: false },
        readCachedImportsFn: readCachedImports
      });
      assert.notEqual(fingerprintVariant.importScanFingerprint, scanResult.importScanFingerprint);

      const runtimeVariant = await scanImports({
        files: [{ abs: filePath, rel: relKey, stat }],
        root: repoRoot,
        mode: 'code',
        languageOptions: {
          collectorScanBudget: { maxChars: 128 },
          rootDir: path.join(tempRoot, 'other-root'),
          treeSitter: {
            enabled: true,
            cachePersistentDir: path.join(tempRoot, 'other-cache'),
            scheduler: {
              transport: 'disk',
              sharedCache: true
            }
          },
          shards: {
            enabled: true,
            maxWorkers: 1
          },
          log() {}
        },
        importConcurrency: 1,
        incrementalState: { enabled: false },
        readCachedImportsFn: readCachedImports
      });
      assert.equal(runtimeVariant.importScanFingerprint, scanResult.importScanFingerprint);
    }
  },
  {
    name: 'stage cache hits skip expensive resolver stages while preserving unresolved warnings',
    async run() {
      const tempRoot = await createImportResolutionTempRoot('imports-contract-stage-cache-hit-miss');
      const srcRoot = path.join(tempRoot, 'src');
      const importerAbs = path.join(srcRoot, 'main.js');
      const importerRel = 'src/main.js';

      await fs.mkdir(srcRoot, { recursive: true });
      await fs.writeFile(importerAbs, "import './missing.js';\n", 'utf8');

      const entries = [{ abs: importerAbs, rel: importerRel }];
      const importsByFile = {
        [importerRel]: ['./missing.js']
      };
      const makeRelations = () => new Map([[importerRel, { imports: ['./missing.js'] }]]);
      const cache = {};
      const fileHashes = new Map([[importerRel, 'hash-main-v1']]);

      const first = resolveImportLinks({
        root: tempRoot,
        entries,
        importsByFile,
        fileRelations: makeRelations(),
        cache,
        fileHashes,
        enableGraph: true
      });
      assert.equal((first?.stats?.resolverPipelineStages?.language_resolver?.attempts || 0) >= 1, true);
      assert.equal((first?.stats?.resolverPipelineStages?.filesystem_probe?.attempts || 0) >= 1, true);
      assert.equal((first?.cacheStats?.specsComputed || 0) >= 1, true);

      const second = resolveImportLinks({
        root: tempRoot,
        entries,
        importsByFile,
        fileRelations: makeRelations(),
        cache,
        fileHashes,
        enableGraph: true
      });
      const secondStages = second?.stats?.resolverPipelineStages || {};
      assert.equal(second?.cacheStats?.specsReused >= 1, true);
      assert.equal(second?.cacheStats?.specsComputed || 0, 0);
      assert.equal(secondStages.language_resolver?.attempts || 0, 0);
      assert.equal(secondStages.filesystem_probe?.attempts || 0, 0);
      assert.equal(secondStages.classify?.attempts || 0, 1);
      assert.equal(secondStages.classify?.degraded || 0, 0);
      assert.equal(secondStages.classify?.budgetExhausted || 0, 0);

      const unresolved = Array.isArray(second?.unresolvedSamples) ? second.unresolvedSamples : [];
      assert.equal(unresolved.length, 1);
      assert.equal(unresolved[0]?.reasonCode, 'IMP_U_MISSING_FILE_RELATIVE');
    }
  }
];

for (const entry of cases) {
  await entry.run();
}

console.log('import cache contract matrix test passed');
