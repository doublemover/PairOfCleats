#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  collectLanguageImportEntries,
  collectLanguageImports
} from '../../../src/index/language-registry.js';

const starlarkText = [
  'load("//tools:deps.bzl", "deps")',
  'bazel_dep(name = "rules_cc", version = "0.0.1")',
  'local_path_override(module_name = "custom", path = "../third_party/custom")'
].join('\n');
const starlarkEntries = collectLanguageImportEntries({
  ext: '.bzl',
  relPath: 'WORKSPACE.bzl',
  text: starlarkText,
  mode: 'code',
  options: {}
});
assert.deepEqual(
  starlarkEntries.map((entry) => entry.specifier),
  collectLanguageImports({
    ext: '.bzl',
    relPath: 'WORKSPACE.bzl',
    text: starlarkText,
    mode: 'code',
    options: {}
  }),
  'starlark import entries should preserve import specifiers'
);
assert.equal(
  starlarkEntries.find((entry) => entry.specifier === '//tools:deps.bzl')?.collectorHint?.reasonCode,
  'IMP_U_RESOLVER_GAP',
  'starlark load labels should emit resolver-gap collector hints'
);
assert.equal(
  starlarkEntries.find((entry) => entry.specifier === '../third_party/custom')?.collectorHint || null,
  null,
  'local path overrides should not be force-tagged as resolver gaps'
);

const nixText = [
  'imports = [ ./hosts/default.nix ../shared/infra.nix ];',
  'inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";',
  'builtins.getFlake "github:owner/repo";'
].join('\n');
const nixEntries = collectLanguageImportEntries({
  ext: '.nix',
  relPath: 'flake.nix',
  text: nixText,
  mode: 'code',
  options: {}
});
const nixSpecifiers = nixEntries.map((entry) => entry.specifier);
assert.ok(nixSpecifiers.includes('./hosts/default.nix'));
assert.ok(nixSpecifiers.includes('../shared/infra.nix'));
assert.equal(
  nixEntries.find((entry) => entry.specifier === 'github:NixOS/nixpkgs/nixos-24.11')?.collectorHint?.reasonCode,
  'IMP_U_RESOLVER_GAP',
  'nix flake references should emit resolver-gap collector hints'
);
assert.equal(
  nixEntries.find((entry) => entry.specifier === 'github:owner/repo')?.collectorHint?.reasonCode,
  'IMP_U_RESOLVER_GAP',
  'builtins.getFlake refs should emit resolver-gap collector hints'
);

console.log('language registry import entries test passed');
