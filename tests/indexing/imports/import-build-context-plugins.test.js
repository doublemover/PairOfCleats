#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createImportBuildContext } from '../../../src/index/build/import-resolution.js';

const entries = [
  { rel: 'src/main.ts' },
  { rel: 'src/proto/client.proto' },
  { rel: 'schema/api.graphql' }
];

const buildContext = createImportBuildContext({ entries });
assert.equal(buildContext.version, 'build-context-v1');
assert.equal(typeof buildContext.fingerprint, 'string');
assert.equal(Array.isArray(buildContext.plugins), true);
assert.deepEqual(
  buildContext.plugins,
  [
    { id: 'bazel-label', priority: 10 },
    { id: 'nix-flake', priority: 15 },
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

const generatedFromIndex = buildContext.classifyUnresolved({
  importerRel: 'src/main.ts',
  spec: './proto/client_pb2.py',
  rawSpec: './proto/client_pb2.py'
});
assert.equal(generatedFromIndex?.reasonCode, 'IMP_U_GENERATED_EXPECTED_MISSING');
assert.equal(generatedFromIndex?.pluginId, 'generated-artifacts');
assert.equal(generatedFromIndex?.generatedMatch?.source, 'index');

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

console.log('import build-context plugins tests passed');
