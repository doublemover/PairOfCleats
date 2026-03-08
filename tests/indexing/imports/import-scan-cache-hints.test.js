#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scanImports } from '../../../src/index/build/imports.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'import-scan-cache-hints');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'repo'), { recursive: true });

const cachedHintPath = path.join(tempRoot, 'repo', 'MODULE.bazel');
const rebuiltHintPath = path.join(tempRoot, 'repo', 'flake.nix');

await fs.writeFile(cachedHintPath, 'load("//tools:deps.bzl", "deps")\n', 'utf8');
await fs.writeFile(rebuiltHintPath, 'inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";\n', 'utf8');

const cachedHintStat = await fs.stat(cachedHintPath);
const rebuiltHintStat = await fs.stat(rebuiltHintPath);

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
    { abs: cachedHintPath, rel: 'repo/MODULE.bazel', stat: cachedHintStat },
    { abs: rebuiltHintPath, rel: 'repo/flake.nix', stat: rebuiltHintStat }
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

assert.deepEqual(result.importsByFile['repo/MODULE.bazel'] || [], ['//tools:deps.bzl']);
assert.deepEqual(result.importsByFile['repo/flake.nix'] || [], ['github:NixOS/nixpkgs/nixos-24.11']);

assert.equal(
  result.importHintsByFile?.['repo/MODULE.bazel']?.['//tools:deps.bzl']?.reasonCode,
  'IMP_U_RESOLVER_GAP',
  'expected cached entry-based collector hint to survive incremental reuse'
);
assert.equal(
  result.importHintsByFile?.['repo/flake.nix']?.['github:NixOS/nixpkgs/nixos-24.11']?.reasonCode,
  'IMP_U_RESOLVER_GAP',
  'expected legacy cached specifier entries to rebuild collector hints from source text'
);

console.log('import scan cache hints test passed');
