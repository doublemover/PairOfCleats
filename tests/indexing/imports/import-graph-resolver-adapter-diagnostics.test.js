#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  updateImportResolutionDiagnosticsCache
} from '../../../src/index/build/import-resolution-cache.js';
import {
  enrichUnresolvedImportSamples,
  summarizeUnresolvedImportTaxonomy
} from '../../../src/index/build/imports.js';

const cache = {};

const firstTaxonomy = summarizeUnresolvedImportTaxonomy(enrichUnresolvedImportSamples([
  {
    importer: 'MODULE.bazel',
    specifier: '//go:missing_extension.bzl',
    reasonCode: 'IMP_U_BAZEL_LABEL_TARGET_MISSING',
    resolverStage: 'build_system_resolver',
    resolverAdapter: 'bazel-label'
  },
  {
    importer: 'app/rules.bzl',
    specifier: ':missing_local.bzl',
    reasonCode: 'IMP_U_BAZEL_LABEL_TARGET_MISSING',
    resolverStage: 'build_system_resolver',
    resolverAdapter: 'bazel-label'
  },
  {
    importer: 'src/main.js',
    specifier: './missing.js',
    reasonCode: 'IMP_U_MISSING_FILE_RELATIVE',
    resolverStage: 'filesystem_probe'
  }
]));

const firstDiagnostics = updateImportResolutionDiagnosticsCache({
  cache,
  unresolvedTaxonomy: firstTaxonomy,
  unresolvedTotal: firstTaxonomy.total
});

assert.deepEqual(
  Object.fromEntries(Object.entries(firstDiagnostics?.unresolvedTrend?.current?.resolverAdapters || {})),
  { 'bazel-label': 2 },
  'expected current diagnostics snapshot to retain resolver adapter counts'
);
assert.deepEqual(
  Object.fromEntries(Object.entries(firstDiagnostics?.unresolvedTrend?.deltaByResolverAdapter || {})),
  { 'bazel-label': 2 },
  'expected first diagnostics write to emit positive resolver adapter delta'
);

const secondTaxonomy = summarizeUnresolvedImportTaxonomy(enrichUnresolvedImportSamples([
  {
    importer: 'src/main.js',
    specifier: './missing.js',
    reasonCode: 'IMP_U_MISSING_FILE_RELATIVE',
    resolverStage: 'filesystem_probe'
  }
]));

const secondDiagnostics = updateImportResolutionDiagnosticsCache({
  cache,
  unresolvedTaxonomy: secondTaxonomy,
  unresolvedTotal: secondTaxonomy.total
});

assert.deepEqual(
  Object.fromEntries(Object.entries(secondDiagnostics?.unresolvedTrend?.previous?.resolverAdapters || {})),
  { 'bazel-label': 2 },
  'expected previous diagnostics snapshot to preserve resolver adapter counts'
);
assert.deepEqual(
  Object.fromEntries(Object.entries(secondDiagnostics?.unresolvedTrend?.current?.resolverAdapters || {})),
  {},
  'expected current diagnostics snapshot to clear resolver adapter counts when no adapters remain'
);
assert.deepEqual(
  Object.fromEntries(Object.entries(secondDiagnostics?.unresolvedTrend?.deltaByResolverAdapter || {})),
  { 'bazel-label': -2 },
  'expected diagnostics delta to capture resolver adapter removal'
);

console.log('import graph resolver adapter diagnostics test passed');
