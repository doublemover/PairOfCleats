import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runWorkspaceCommandPreflight } from '../../../src/index/tooling/preflight/workspace-command-preflight.js';
import { buildWorkspaceCommandPreflightFingerprint, resolveWorkspaceCommandPreflightMarkerPath } from '../../../src/index/tooling/preflight/workspace-command-preflight-cache.js';
import { createConfiguredLspProvider } from '../../../src/index/tooling/lsp-provider/factory.js';
import { normalizeServerConfig } from '../../../src/index/tooling/lsp-provider/normalize.js';
import { createLspProviderTempRepo, buildSingleSymbolInputs, resolveLspStubServerPath } from '../../helpers/lsp-provider-fixture.js';
import { grantFixtureRepositoryExecution } from '../../helpers/execution-authority.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { cleanupLspTestRuntime } from '../../helpers/lsp-runtime.js';

// Authored admission/cache consumer regression. Runtime execution is deferred to
// the lead's final integration pass while parallel source owners are writing.
const commandName = process.platform === 'win32' ? 'denied-probe.cmd' : 'denied-probe';
const root = await createLspProviderTempRepo({ name: 'workspace-probe-admission-cache', files: [
  { path: 'go.mod', content: 'module fixture.test/probe\n\ngo 1.24\n' },
  { path: 'main.go', content: 'package main\nfunc Greet(name string) string { return name }\n' },
  { path: commandName, content: process.platform === 'win32'
    ? '@echo off\r\necho executed>denied.marker\r\nexit /b 0\r\n' : '#!/bin/sh\ntouch denied.marker\n' },
  { path: 'probe.mjs', content: "import fs from 'node:fs'; fs.appendFileSync('probe-count.txt', 'x'); console.log('fixture workspace ready');\n" }
] });
const deniedCommand = path.join(root, commandName);
const inputs = buildSingleSymbolInputs({ scenarioName: 'workspace-probe-admission', virtualPath: 'main.go',
  text: 'package main\nfunc Greet(name string) string { return name }\n', languageId: 'go', effectiveExt: '.go', symbolName: 'Greet' });
try {
  await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_REPOS: '[]' }, async () => {
    const server = normalizeServerConfig({ id: 'go-denied-probe', preset: 'gopls', cmd: process.execPath,
      args: [resolveLspStubServerPath(), '--mode', 'go'], goWorkspaceModuleCmd: deniedCommand,
      goWorkspaceModuleArgs: ['--fixture'], goWorkspaceWarmup: false }, 0);
    const provider = createConfiguredLspProvider(server);
    const ctx = { repoRoot: root, buildRoot: root, toolingConfig: {}, cache: { enabled: false } };
    const output = await provider.run(ctx, inputs);
    assert.deepEqual(output.byChunkUid, {}, 'denied module probe blocks retained provider output');
    assert.equal(output.diagnostics.fidelity.state, 'blocked');
    assert.ok(output.diagnostics.checks.some(check => check.name.includes('command_denied')));
    await assert.rejects(fs.access(path.join(root, 'denied.marker')), { code: 'ENOENT' });
  });
  const restore = grantFixtureRepositoryExecution(root);
  try {
    const options = { ctx: { repoRoot: root, toolingConfig: {} }, cwd: root, cmd: process.execPath,
      args: [path.join(root, 'probe.mjs')], timeoutMs: 1000, reasonPrefix: 'fixture_workspace_probe',
      label: 'Fixture workspace', successCache: { repoRoot: root, namespace: 'fixture-workspace',
        watchedFiles: [{ path: path.join(root, 'go.mod'), mode: 'content' }] } };
    assert.equal((await runWorkspaceCommandPreflight(options)).state, 'ready');
    assert.equal((await runWorkspaceCommandPreflight(options)).cached, true);
    assert.equal(await fs.readFile(path.join(root, 'probe-count.txt'), 'utf8'), 'x');
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(runWorkspaceCommandPreflight({ ...options, abortSignal: aborted.signal }), { code: 'ABORT_ERR' });
    const cacheAdmission = new AbortController();
    await assert.rejects(runWorkspaceCommandPreflight({ ...options, abortSignal: cacheAdmission.signal,
      log: () => cacheAdmission.abort() }), { code: 'ABORT_ERR' });
    await fs.appendFile(path.join(root, 'go.mod'), '// changed model\n');
    assert.equal((await runWorkspaceCommandPreflight(options)).cached, undefined);
    assert.equal(await fs.readFile(path.join(root, 'probe-count.txt'), 'utf8'), 'xx');
    await withTemporaryEnv({ GOPROXY: 'off' }, async () => {
      assert.equal((await runWorkspaceCommandPreflight(options)).cached, undefined);
    });
    assert.equal(await fs.readFile(path.join(root, 'probe-count.txt'), 'utf8'), 'xxx');
    const markerPath = resolveWorkspaceCommandPreflightMarkerPath({ repoRoot: root, namespace: 'fixture-workspace' });
    const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
    assert.equal(marker.schemaVersion, 3);
    const fingerprintOptions = { repoRoot: root, command: deniedCommand, args: [], watchedFiles: [] };
    const before = await buildWorkspaceCommandPreflightFingerprint(fingerprintOptions);
    await fs.appendFile(deniedCommand, '\nchanged executable identity\n');
    assert.notEqual(await buildWorkspaceCommandPreflightFingerprint(fingerprintOptions), before);
    await assert.rejects(buildWorkspaceCommandPreflightFingerprint({ ...fingerprintOptions,
      watchedFiles: [{ path: process.execPath, mode: 'content' }] }), { code: 'ERR_UNSAFE_FILE_PATH' });
  } finally { restore(); }
} finally {
  await cleanupLspTestRuntime({ reason: 'workspace_probe_admission_cache', strict: true });
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Workspace command denial, cache admission and dependency/environment/tool identity reach configured-provider consumers');
