#!/usr/bin/env node
import assert from 'node:assert/strict';
import { collectLanguageImportEntries } from '../../../src/index/language-registry.js';

const diagnostics = [];

const starlarkText = [
  'load("//tools:deps.bzl", "deps")',
  'bazel_dep(name = "rules_proto")',
  'bazel_dep(name = "rules_cc")'
].join('\n');

const starlarkEntries = collectLanguageImportEntries({
  ext: '.bzl',
  relPath: 'tools/deps.bzl',
  text: starlarkText,
  mode: 'code',
  options: {
    collectorDiagnostics: diagnostics,
    collectorScanBudgets: {
      starlark: {
        maxMatches: 1,
        maxTokens: 1
      }
    }
  }
});

assert.equal(Array.isArray(starlarkEntries), true, 'expected starlark import entries array');

const nixText = `imports = [ ${Array.from({ length: 8 }, (_, idx) => `./m${idx}.nix`).join(' ')} ];`;
const nixEntries = collectLanguageImportEntries({
  ext: '.nix',
  relPath: 'flake.nix',
  text: nixText,
  mode: 'code',
  options: {
    collectorDiagnostics: diagnostics,
    collectorScanBudgets: {
      nix: {
        maxTokens: 2
      }
    }
  }
});

assert.equal(Array.isArray(nixEntries), true, 'expected nix import entries array');

const starlarkBudgetDiagnostic = diagnostics.find((entry) => (
  entry?.type === 'collector-scan-budget'
  && entry?.collectorId === 'starlark'
));
assert.ok(starlarkBudgetDiagnostic, 'expected starlark collector budget diagnostic');

const nixBudgetDiagnostic = diagnostics.find((entry) => (
  entry?.type === 'collector-scan-budget'
  && entry?.collectorId === 'nix'
));
assert.ok(nixBudgetDiagnostic, 'expected nix collector budget diagnostic');

console.log('language collector budget diagnostics test passed');
