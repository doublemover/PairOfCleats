#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scanImports } from '../../../src/index/build/imports.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'import-scan-collector-hints');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'repo'), { recursive: true });
const starlarkPath = path.join(tempRoot, 'repo', 'MODULE.bazel');
const nixPath = path.join(tempRoot, 'repo', 'flake.nix');
await fs.writeFile(starlarkPath, 'load("//tools:deps.bzl", "deps")\n', 'utf8');
await fs.writeFile(nixPath, 'inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";\n', 'utf8');

const starlarkStat = await fs.stat(starlarkPath);
const nixStat = await fs.stat(nixPath);

const result = await scanImports({
  files: [
    { abs: starlarkPath, rel: 'repo/MODULE.bazel', stat: starlarkStat },
    { abs: nixPath, rel: 'repo/flake.nix', stat: nixStat }
  ],
  root: tempRoot,
  mode: 'code',
  languageOptions: {},
  importConcurrency: 1
});

assert.deepEqual(result.importsByFile['repo/MODULE.bazel'] || [], ['//tools:deps.bzl']);
assert.deepEqual(result.importsByFile['repo/flake.nix'] || [], ['github:NixOS/nixpkgs/nixos-24.11']);

assert.equal(
  result.importHintsByFile?.['repo/MODULE.bazel']?.['//tools:deps.bzl']?.reasonCode,
  'IMP_U_RESOLVER_GAP'
);
assert.equal(
  result.importHintsByFile?.['repo/flake.nix']?.['github:NixOS/nixpkgs/nixos-24.11']?.reasonCode,
  'IMP_U_RESOLVER_GAP'
);

console.log('import scan collector hints test passed');
