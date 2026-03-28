#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';

import { acquireFileLock } from '../../../src/shared/locks/file-lock.js';
import {
  buildSingleSymbolInputs,
  createLspProviderTempRepo,
  resolveLspFixtureCommand,
  runDedicatedProviderFixture
} from '../../helpers/lsp-provider-fixture.js';
import { withLspTestPath } from '../../helpers/lsp-runtime.js';

const root = process.cwd();

const makeCase = (config) => config;

const cases = [
  makeCase({
    name: 'jdtls blocks invalid launch contracts',
    repo: { directories: ['src'], files: [{ path: 'pom.xml', content: '<project/>' }] },
    providerId: 'jdtls',
    providerConfigKey: 'jdtls',
    docText: 'class App { String greet(String name) { return name; } }\n',
    virtualPath: 'src/App.java',
    languageId: 'java',
    effectiveExt: '.java',
    symbolName: 'greet',
    providerConfig(tempRoot) {
      return {
        cmd: resolveLspFixtureCommand('jdtls', { repoRoot: root }),
        args: ['-configuration']
      };
    },
    assertDiagnostics(result, inputs) {
      assert.equal(result.byChunkUid.has(inputs.chunkUid), false, 'expected jdtls provider to be blocked by invalid launch contract');
      const diagnostics = result.diagnostics?.jdtls || {};
      assert.equal(diagnostics?.preflight?.state, 'blocked');
      assert.equal(diagnostics?.preflight?.reasonCode, 'jdtls_launch_contract_invalid');
      assert.equal((diagnostics?.checks || []).some((check) => check?.name === 'jdtls_launch_contract_invalid'), true);
    }
  }),
  makeCase({
    name: 'csharp blocks invalid dotnet launch contracts',
    repo: { directories: ['src'], files: [{ path: 'sample.sln', content: 'Microsoft Visual Studio Solution File\n' }] },
    providerId: 'csharp-ls',
    providerConfigKey: 'csharp',
    docText: 'class App { string Greet(string name) => name; }\n',
    virtualPath: 'src/App.cs',
    languageId: 'csharp',
    effectiveExt: '.cs',
    symbolName: 'Greet',
    providerConfig() {
      return { cmd: 'dotnet', args: [] };
    },
    assertDiagnostics(result, inputs) {
      assert.equal(result.byChunkUid.has(inputs.chunkUid), false, 'expected csharp provider to be blocked by invalid dotnet launch contract');
      const diagnostics = result.diagnostics?.['csharp-ls'] || {};
      assert.equal(diagnostics?.preflight?.state, 'blocked');
      assert.equal(diagnostics?.preflight?.reasonCode, 'csharp_launch_contract_invalid');
      assert.equal((diagnostics?.checks || []).some((check) => check?.name === 'csharp_launch_contract_invalid'), true);
    }
  }),
  makeCase({
    name: 'csharp blocks missing launcher assemblies',
    repo: { directories: ['src'], files: [{ path: 'sample.sln', content: 'Microsoft Visual Studio Solution File\n' }] },
    providerId: 'csharp-ls',
    providerConfigKey: 'csharp',
    docText: 'class App { string Greet(string name) => name; }\n',
    virtualPath: 'src/App.cs',
    languageId: 'csharp',
    effectiveExt: '.cs',
    symbolName: 'Greet',
    providerConfig() {
      return { cmd: 'dotnet', args: ['tools/csharp-ls.dll'] };
    },
    assertDiagnostics(result, inputs) {
      assert.equal(result.byChunkUid.has(inputs.chunkUid), false, 'expected csharp provider to be blocked when dotnet launcher assembly is missing');
      const diagnostics = result.diagnostics?.['csharp-ls'] || {};
      assert.equal(diagnostics?.preflight?.state, 'blocked');
      assert.equal(diagnostics?.preflight?.reasonCode, 'csharp_launch_bootstrap_missing');
      assert.equal((diagnostics?.checks || []).some((check) => check?.name === 'csharp_launch_bootstrap_missing'), true);
    }
  }),
  makeCase({
    name: 'jdtls blocks launch script mismatches',
    repo: { directories: ['src'], files: [{ path: 'pom.xml', content: '<project/>' }] },
    providerId: 'jdtls',
    providerConfigKey: 'jdtls',
    docText: 'class App { String greet(String name) { return name; } }\n',
    virtualPath: 'src/App.java',
    languageId: 'java',
    effectiveExt: '.java',
    symbolName: 'greet',
    providerConfig() {
      return { cmd: 'java', args: ['-Xmx512m'] };
    },
    assertDiagnostics(result, inputs) {
      assert.equal(result.byChunkUid.has(inputs.chunkUid), false, 'expected jdtls provider to be blocked by launch script mismatch');
      const diagnostics = result.diagnostics?.jdtls || {};
      assert.equal(diagnostics?.preflight?.state, 'blocked');
      assert.equal(diagnostics?.preflight?.reasonCode, 'jdtls_launch_script_mismatch');
      assert.equal((diagnostics?.checks || []).some((check) => check?.name === 'jdtls_launch_script_mismatch'), true);
    }
  }),
  makeCase({
    name: 'jdtls blocks unavailable workspace locks',
    repo: { directories: ['src'], files: [{ path: 'pom.xml', content: '<project/>' }] },
    providerId: 'jdtls',
    providerConfigKey: 'jdtls',
    docText: 'class App { int add(int a, int b) { return a + b; } }\n',
    virtualPath: 'src/App.java',
    languageId: 'java',
    effectiveExt: '.java',
    symbolName: 'add',
    async providerConfig(tempRoot) {
      const workspaceDataDir = path.join(tempRoot, '.jdtls-workspace');
      const workspaceLockPath = path.join(workspaceDataDir, '.workspace.runtime.lock.json');
      const lock = await acquireFileLock({
        lockPath: workspaceLockPath,
        waitMs: 0,
        pollMs: 25,
        staleMs: 60 * 1000,
        metadata: { scope: 'test-jdtls-lock-holder' },
        forceStaleCleanup: true
      });
      assert.ok(lock, 'expected to acquire workspace lock fixture');
      return {
        config: {
          cmd: resolveLspFixtureCommand('jdtls', { repoRoot: root }),
          workspaceDataDir
        },
        cleanup: async () => lock.release()
      };
    },
    assertDiagnostics(result, inputs) {
      assert.equal(result.byChunkUid.has(inputs.chunkUid), false, 'expected jdtls provider to be blocked by workspace lock');
      const diagnostics = result.diagnostics?.jdtls || {};
      assert.equal((diagnostics?.checks || []).some((check) => check?.name === 'jdtls_workspace_lock_unavailable'), true);
    }
  })
];

await withLspTestPath({ repoRoot: root }, async () => {
  for (const [index, testCase] of cases.entries()) {
    const tempRoot = await createLspProviderTempRepo({
      repoRoot: root,
      name: `dedicated-provider-launch-guard-${index}`,
      directories: testCase.repo.directories,
      files: testCase.repo.files
    });
    const inputs = buildSingleSymbolInputs({
      scenarioName: `dedicated-provider-launch-guard-${index}`,
      virtualPath: testCase.virtualPath,
      text: testCase.docText,
      languageId: testCase.languageId,
      effectiveExt: testCase.effectiveExt,
      symbolName: testCase.symbolName
    });

    let cleanup = async () => {};
    try {
      const configResult = await testCase.providerConfig(tempRoot);
      const providerConfig = configResult?.config || configResult;
      cleanup = configResult?.cleanup || cleanup;
      const result = await runDedicatedProviderFixture({
        tempRoot,
        providerId: testCase.providerId,
        providerConfigKey: testCase.providerConfigKey,
        providerConfig,
        inputs
      });
      testCase.assertDiagnostics(result, inputs);
    } finally {
      await cleanup();
    }
  }
});

console.log('Dedicated provider launch guard matrix test passed');
