#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  buildSingleSymbolInputs,
  createLspProviderTempRepo,
  resolveLspFixtureCommand,
  runDedicatedProviderFixture
} from '../../helpers/lsp-provider-fixture.js';
import { withLspTestPath } from '../../helpers/lsp-runtime.js';
import { writeRuntimeCommandFixture } from '../../helpers/runtime-command-fixture.js';

const root = process.cwd();
const tempRoot = await createLspProviderTempRepo({
  repoRoot: root,
  name: 'solargraph-provider-runtime-toolchain-missing-bundle-preflight',
  directories: ['lib', '.runtime-bin'],
  files: [
    { path: 'Gemfile', content: "source 'https://rubygems.org'\n" },
    { path: 'Gemfile.lock', content: 'GEM\n  specs:\n\nPLATFORMS\n  ruby\n\nDEPENDENCIES\n\n' }
  ]
});
const runtimeBinDir = path.join(tempRoot, '.runtime-bin');
await writeRuntimeCommandFixture({
  binDir: runtimeBinDir,
  name: 'ruby',
  stdout: 'ruby 3.3.0p0 (2024-01-01 revision 000000) [x64-mingw32]\n'
});
await writeRuntimeCommandFixture({
  binDir: runtimeBinDir,
  name: 'gem',
  stdout: '3.5.0\n'
});
await writeRuntimeCommandFixture({
  binDir: runtimeBinDir,
  name: 'bundle',
  stderr: 'bundle: command not found\n',
  exitCode: 127
});

const fixtureSolargraphCmd = resolveLspFixtureCommand('solargraph', { repoRoot: root });
const docText = 'def greet(name)\n  name\nend\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'solargraph-runtime-toolchain-missing-bundle-preflight',
  virtualPath: 'lib/app.rb',
  text: docText,
  languageId: 'ruby',
  effectiveExt: '.rb',
  symbolName: 'greet'
});

await withLspTestPath({ repoRoot: root, extraPrepend: [runtimeBinDir] }, async () => {
  const result = await runDedicatedProviderFixture({
    tempRoot,
    providerId: 'solargraph',
    providerConfigKey: 'solargraph',
    providerConfig: {
      cmd: fixtureSolargraphCmd
    },
    inputs
  });

  const diagnostics = result.diagnostics?.solargraph || {};
  assert.equal(diagnostics?.preflight?.state, 'degraded', 'expected solargraph preflight degraded state');
  assert.equal(
    diagnostics?.preflight?.reasonCode,
    'solargraph_runtime_toolchain_missing_bundle',
    'expected solargraph runtime toolchain missing bundle reason code'
  );
  const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
  assert.equal(
    checks.some((check) => check?.name === 'solargraph_runtime_toolchain_missing_bundle'),
    true,
    'expected solargraph runtime toolchain missing bundle warning check'
  );
});

console.log('solargraph provider runtime toolchain missing bundle preflight test passed');
