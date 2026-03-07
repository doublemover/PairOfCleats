#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createImportBuildContext } from '../../../src/index/build/import-resolution.js';
import { buildGeneratedPolicyConfig } from '../../../src/index/build/generated-policy.js';

const entries = [
  { rel: 'src/main.ts' },
  { rel: 'src/proto/client.proto' },
  { rel: 'schema/api.graphql' },
  { rel: 'api/openapi.yaml' }
];

const buildContext = createImportBuildContext({ entries });
assert.equal(buildContext.version, 'build-context-v2');
assert.equal(typeof buildContext.fingerprint, 'string');
assert.equal(Array.isArray(buildContext.plugins), true);
assert.deepEqual(
  buildContext.plugins,
  [
    { id: 'bazel-label', priority: 10 },
    { id: 'nix-flake', priority: 15 },
    { id: 'typescript-emit', priority: 18 },
    { id: 'generated-artifacts', priority: 20 }
  ],
  'expected deterministic plugin priority ordering'
);

const bazelResult = buildContext.classifyUnresolved({
  importerRel: 'MODULE.bazel',
  spec: '//tools:missing_extension.bzl',
  rawSpec: '//tools:missing_extension.bzl'
});
assert.equal(bazelResult?.reasonCode, 'IMP_U_RESOLVER_GAP');
assert.equal(bazelResult?.pluginId, 'bazel-label');

const bazelLocalResult = buildContext.classifyUnresolved({
  importerRel: 'app/rules.bzl',
  spec: ':missing_local.bzl',
  rawSpec: ':missing_local.bzl'
});
assert.equal(bazelLocalResult?.reasonCode, 'IMP_U_RESOLVER_GAP');
assert.equal(bazelLocalResult?.pluginId, 'bazel-label');

const bazelExternalResult = buildContext.classifyUnresolved({
  importerRel: 'app/rules.bzl',
  spec: '@repo_tools//defs:missing.bzl',
  rawSpec: '@repo_tools//defs:missing.bzl'
});
assert.equal(bazelExternalResult?.reasonCode, 'IMP_U_RESOLVER_GAP');
assert.equal(bazelExternalResult?.pluginId, 'bazel-label');

const generatedFromIndex = buildContext.classifyUnresolved({
  importerRel: 'src/main.ts',
  spec: './proto/client_pb2.py',
  rawSpec: './proto/client_pb2.py'
});
assert.equal(generatedFromIndex?.reasonCode, 'IMP_U_GENERATED_EXPECTED_MISSING');
assert.equal(generatedFromIndex?.pluginId, 'generated-artifacts');
assert.equal(generatedFromIndex?.generatedMatch?.source, 'index');

const generatedOpenApi = buildContext.classifyUnresolved({
  importerRel: 'api/main.ts',
  spec: './generated/openapi-client.ts',
  rawSpec: './generated/openapi-client.ts'
});
assert.equal(generatedOpenApi?.reasonCode, 'IMP_U_GENERATED_EXPECTED_MISSING');
assert.equal(generatedOpenApi?.pluginId, 'generated-artifacts');
assert.equal(generatedOpenApi?.generatedMatch?.source, 'index');

const generatedFromVendorPolicy = buildContext.classifyUnresolved({
  importerRel: 'src/main.ts',
  spec: '../vendor/runtime/app.min.js',
  rawSpec: '../vendor/runtime/app.min.js'
});
assert.equal(generatedFromVendorPolicy?.reasonCode, 'IMP_U_GENERATED_EXPECTED_MISSING');
assert.equal(generatedFromVendorPolicy?.pluginId, 'generated-artifacts');
assert.equal(generatedFromVendorPolicy?.generatedMatch?.source, 'generated-policy');
assert.equal(generatedFromVendorPolicy?.generatedMatch?.classification, 'minified');

const generatedFromNodeModulesPolicy = buildContext.classifyUnresolved({
  importerRel: 'src/main.ts',
  spec: '../node_modules/pkg/runtime.js',
  rawSpec: '../node_modules/pkg/runtime.js'
});
assert.equal(generatedFromNodeModulesPolicy?.reasonCode, 'IMP_U_GENERATED_EXPECTED_MISSING');
assert.equal(generatedFromNodeModulesPolicy?.pluginId, 'generated-artifacts');
assert.equal(generatedFromNodeModulesPolicy?.generatedMatch?.source, 'generated-policy');
assert.equal(generatedFromNodeModulesPolicy?.generatedMatch?.classification, 'vendor');

const nixResult = buildContext.classifyUnresolved({
  importerRel: 'nix/flake.nix',
  spec: '<nixpkgs>',
  rawSpec: '<nixpkgs>'
});
assert.equal(nixResult?.reasonCode, 'IMP_U_RESOLVER_GAP');
assert.equal(nixResult?.pluginId, 'nix-flake');

const configurableContext = createImportBuildContext({
  entries: [{ rel: 'src/main.ts' }],
  resolverPlugins: {
    buildContext: {
      generatedArtifactsConfig: {
        suffixes: ['.codegen.ts']
      }
    }
  }
});
const generatedFromConfig = configurableContext.classifyUnresolved({
  importerRel: 'src/main.ts',
  spec: './code-output/client.codegen.ts',
  rawSpec: './code-output/client.codegen.ts'
});
assert.equal(generatedFromConfig?.reasonCode, 'IMP_U_GENERATED_EXPECTED_MISSING');
assert.equal(generatedFromConfig?.pluginId, 'generated-artifacts');
assert.equal(generatedFromConfig?.generatedMatch?.source, 'plugin-config');

const includeOverrideContext = createImportBuildContext({
  entries: [{ rel: 'src/main.ts' }],
  generatedPolicy: buildGeneratedPolicyConfig({
    generatedPolicy: {
      include: ['vendor/**']
    }
  })
});
const includedVendor = includeOverrideContext.classifyUnresolved({
  importerRel: 'src/main.ts',
  spec: '../vendor/runtime/app.min.js',
  rawSpec: '../vendor/runtime/app.min.js'
});
assert.equal(includedVendor, null, 'generated-policy include should bypass unresolved suppression for included paths');

console.log('import build-context plugins tests passed');
