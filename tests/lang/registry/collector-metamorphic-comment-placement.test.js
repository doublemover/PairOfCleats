#!/usr/bin/env node
import assert from 'node:assert/strict';
import { collectNixImports } from '../../../src/index/language-registry/import-collectors/nix.js';
import { collectProtoImports } from '../../../src/index/language-registry/import-collectors/proto.js';
import { collectStarlarkImports } from '../../../src/index/language-registry/import-collectors/starlark.js';

const sortUnique = (values) => Array.from(new Set(values || [])).sort();

const expectEquivalent = (label, collector, textA, textB) => {
  const a = sortUnique(collector(textA));
  const b = sortUnique(collector(textB));
  assert.deepEqual(
    b,
    a,
    `${label}: comment/doc placement should not alter detected imports`
  );
};

expectEquivalent(
  'nix',
  collectNixImports,
  [
    'import ./module.nix',
    'callPackage ../pkg/default.nix {}',
    'inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";'
  ].join('\n'),
  [
    '# import ./ignored.nix',
    'import ./module.nix # trailing comment',
    '# callPackage ../ignored/default.nix {}',
    'callPackage ../pkg/default.nix {} # keep',
    '',
    'inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11"; # pinned'
  ].join('\n')
);

expectEquivalent(
  'starlark',
  collectStarlarkImports,
  [
    'load("//tools:deps.bzl", "deps")',
    'bazel_dep(name = "rules_cc", version = "0.0.1")'
  ].join('\n'),
  [
    '# load("//ignored:deps.bzl", "deps")',
    'load("//tools:deps.bzl", "deps") # keep',
    '# bazel_dep(name = "rules_java", version = "0.1.0")',
    'bazel_dep(name = "rules_cc", version = "0.0.1")'
  ].join('\n')
);

expectEquivalent(
  'proto',
  collectProtoImports,
  [
    'import "foo.proto";',
    'import public "bar.proto";'
  ].join('\n'),
  [
    '// import "ignored.proto";',
    'import "foo.proto"; // trailing note',
    '/* block */ import public "bar.proto";'
  ].join('\n')
);

console.log('collector metamorphic comment placement test passed');
