#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';
import { scanImports } from '../../../src/index/build/imports.js';
import { readCachedImports } from '../../../src/index/build/incremental.js';
import { resolveBundleFilename, writeBundleFile } from '../../../src/shared/bundle-io.js';
import { sha1 } from '../../../src/shared/hash.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();

const createTempRoot = async (name) => {
  const tempRoot = resolveTestCachePath(root, name);
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(tempRoot, { recursive: true });
  return tempRoot;
};

const cases = [
  {
    name: 'collector hints are emitted for direct scans',
    async run() {
      const tempRoot = await createTempRoot('imports-contract-collector-hints');
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
      const tempRoot = await createTempRoot('imports-contract-cache-hints');
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
      const tempRoot = await createTempRoot('imports-contract-cache-read');
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
    name: 'import scan fingerprints gate cache reuse while ignoring runtime-only options',
    async run() {
      const tempRoot = await createTempRoot('imports-contract-budget-cache-key');
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
      const tempRoot = await createTempRoot('imports-contract-stage-cache-hit-miss');
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
