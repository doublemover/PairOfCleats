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
assert.equal(buildContext.version, 'build-context-v4');
assert.equal(typeof buildContext.fingerprint, 'string');
assert.equal(Array.isArray(buildContext.plugins), true);
assert.deepEqual(
  buildContext.plugins,
  [
    { id: 'bazel-label', priority: 10 },
    { id: 'path-context', priority: 12 },
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

const bazelRootTraversal = buildContext.classifyUnresolved({
  importerRel: 'MODULE.bazel',
  spec: '../..',
  rawSpec: '../..'
});
assert.equal(bazelRootTraversal?.reasonCode, 'IMP_U_BAZEL_WORKSPACE_ROOT_SENTINEL');
assert.equal(bazelRootTraversal?.pluginId, 'path-context');

const configRootSentinel = buildContext.classifyUnresolved({
  importerRel: '.github/workflows/installer/vercel.json',
  spec: '/',
  rawSpec: '/'
});
assert.equal(configRootSentinel?.reasonCode, 'IMP_U_CONFIG_ROOT_SENTINEL');
assert.equal(configRootSentinel?.pluginId, 'path-context');

const configRootAnchoredPath = buildContext.classifyUnresolved({
  importerRel: 'website/vercel.json',
  spec: '/api',
  rawSpec: '/api'
});
assert.equal(configRootAnchoredPath?.reasonCode, 'IMP_U_CONFIG_ROOT_ANCHORED_PATH');
assert.equal(configRootAnchoredPath?.pluginId, 'path-context');

const configGlobPattern = buildContext.classifyUnresolved({
  importerRel: 'website/tsconfig.json',
  spec: '.next/types/**/*.ts',
  rawSpec: '.next/types/**/*.ts'
});
assert.equal(configGlobPattern?.reasonCode, 'IMP_U_CONFIG_GLOB_PATTERN');
assert.equal(configGlobPattern?.pluginId, 'path-context');

const htmlFixtureReference = buildContext.classifyUnresolved({
  importerRel: 'tests/manual/index.html',
  spec: '/dist/app.js',
  rawSpec: '/dist/app.js'
});
assert.equal(htmlFixtureReference?.reasonCode, 'IMP_U_FIXTURE_REFERENCE');
assert.equal(htmlFixtureReference?.pluginId, 'path-context');

const testingHarnessReference = buildContext.classifyUnresolved({
  importerRel: 'testing/e2e.sh',
  spec: './testing/e2e/util.sh',
  rawSpec: './testing/e2e/util.sh'
});
assert.equal(testingHarnessReference?.reasonCode, 'IMP_U_FIXTURE_REFERENCE');
assert.equal(testingHarnessReference?.pluginId, 'path-context');

const specSupportReference = buildContext.classifyUnresolved({
  importerRel: 'spec/models/agents/mqtt_agent_spec.rb',
  spec: './spec/support/fake_mqtt_server',
  rawSpec: './spec/support/fake_mqtt_server'
});
assert.equal(specSupportReference?.reasonCode, 'IMP_U_FIXTURE_REFERENCE');
assert.equal(specSupportReference?.pluginId, 'path-context');

const fixtureDotReference = buildContext.classifyUnresolved({
  importerRel: 'tests/inputs/Makefile',
  spec: '.o',
  rawSpec: '.o'
});
assert.equal(fixtureDotReference?.reasonCode, 'IMP_U_FIXTURE_REFERENCE');
assert.equal(fixtureDotReference?.pluginId, 'path-context');

const vendoredSurfaceReference = buildContext.classifyUnresolved({
  importerRel: 'src/main/webapp/assets/vendors/ace/ext-beautify.js',
  spec: '../token_iterator',
  rawSpec: '../token_iterator'
});
assert.equal(vendoredSurfaceReference?.reasonCode, 'IMP_U_FIXTURE_REFERENCE');
assert.equal(vendoredSurfaceReference?.pluginId, 'path-context');

const optionalDependency = buildContext.classifyUnresolved({
  importerRel: 'src/main.ts',
  spec: 'fsevents',
  rawSpec: 'fsevents'
});
assert.equal(optionalDependency?.reasonCode, 'IMP_U_OPTIONAL_DEPENDENCY');
assert.equal(optionalDependency?.pluginId, 'path-context');

const nixRootAnchoredPath = buildContext.classifyUnresolved({
  importerRel: 'hardening/profiles/default.nix',
  spec: '/profiles/hardened.nix',
  rawSpec: '/profiles/hardened.nix'
});
assert.equal(nixRootAnchoredPath?.reasonCode, 'IMP_U_CONFIG_ROOT_ANCHORED_PATH');
assert.equal(nixRootAnchoredPath?.pluginId, 'path-context');

const bazelEqualDepthRootTraversal = buildContext.classifyUnresolved({
  importerRel: 'examples/android/MODULE.bazel',
  spec: '../..',
  rawSpec: '../..'
});
assert.equal(bazelEqualDepthRootTraversal?.reasonCode, 'IMP_U_BAZEL_WORKSPACE_ROOT_SENTINEL');
assert.equal(bazelEqualDepthRootTraversal?.pluginId, 'path-context');

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

const generatedFromDistPolicy = buildContext.classifyUnresolved({
  importerRel: 'src/main.ts',
  spec: '../dist/runtime/app.js',
  rawSpec: '../dist/runtime/app.js'
});
assert.equal(generatedFromDistPolicy, null);

const generatedFromBuildScript = buildContext.classifyUnresolved({
  importerRel: 'bin/check-build-version.js',
  spec: '../dist/node/axios.cjs',
  rawSpec: '../dist/node/axios.cjs'
});
assert.equal(generatedFromBuildScript?.reasonCode, 'IMP_U_GENERATED_EXPECTED_MISSING');
assert.equal(generatedFromBuildScript?.pluginId, 'path-context');
assert.equal(generatedFromBuildScript?.generatedMatch?.matchType, 'build_output_script_reference');

const buildRuntimeRootReference = buildContext.classifyUnresolved({
  importerRel: 'docker/scripts/setup_env',
  spec: '/tmp/.env',
  rawSpec: '/tmp/.env'
});
assert.equal(buildRuntimeRootReference?.reasonCode, 'IMP_U_RESOLVER_GAP');
assert.equal(buildRuntimeRootReference?.pluginId, 'path-context');

const webRuntimeBootstrapReference = buildContext.classifyUnresolved({
  importerRel: '10.0/BlazorWebAssemblyReact/blazor/wwwroot/main.js',
  spec: './_framework/blazor.webassembly.js',
  rawSpec: './_framework/blazor.webassembly.js'
});
assert.equal(webRuntimeBootstrapReference?.reasonCode, 'IMP_U_GENERATED_EXPECTED_MISSING');
assert.equal(webRuntimeBootstrapReference?.pluginId, 'path-context');
assert.equal(webRuntimeBootstrapReference?.generatedMatch?.matchType, 'web_runtime_bootstrap_reference');

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
