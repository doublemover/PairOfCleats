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
const tempRoot = await createLspProviderTempRepo({
  repoRoot: root,
  name: 'jdtls-provider-workspace-lock-unavailable',
  directories: ['src'],
  files: [{ path: 'pom.xml', content: '<project/>' }]
});
const fixtureJdtlsCmd = resolveLspFixtureCommand('jdtls', { repoRoot: root });
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

const docText = 'class App { int add(int a, int b) { return a + b; } }\n';
const inputs = buildSingleSymbolInputs({
  scenarioName: 'jdtls-workspace-lock-unavailable',
  virtualPath: 'src/App.java',
  text: docText,
  languageId: 'java',
  effectiveExt: '.java',
  symbolName: 'add'
});

try {
  await withLspTestPath({ repoRoot: root }, async () => {
    const result = await runDedicatedProviderFixture({
      tempRoot,
      providerId: 'jdtls',
      providerConfigKey: 'jdtls',
      providerConfig: {
        cmd: fixtureJdtlsCmd,
        workspaceDataDir
      },
      inputs
    });

    assert.equal(result.byChunkUid.has(inputs.chunkUid), false, 'expected jdtls provider to be blocked by workspace lock');
    const checks = result.diagnostics?.jdtls?.checks || [];
    assert.equal(
      checks.some((check) => check?.name === 'jdtls_workspace_lock_unavailable'),
      true,
      'expected jdtls workspace lock unavailable warning'
    );
  });
} finally {
  await lock.release();
}

console.log('jdtls provider workspace lock unavailable test passed');
