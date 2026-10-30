import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';
import { prepareServiceMappingFixture } from '../../helpers/vscode/service-mapping-fixture.js';
import { getRuntimeCapabilityManifest } from '../../../src/shared/runtime-capability-manifest.js';

const first = createVsCodeRuntimeTempRepo({ prefix: 'poc-search-replay-a-' });
const second = createVsCodeRuntimeTempRepo({ prefix: 'poc-search-replay-b-' });
const installation = createVsCodeRuntimeTempRepo({ prefix: 'poc-search-replay-cli-' });
const currentCli = path.join(installation, 'bin', 'pairofcleats.js');
const baseUrl = 'http://127.0.0.1:4311';
const options = { searchMode: 'code', searchBackend: 'sqlite', searchFilter: 'lang:typescript',
  searchModifiedSince: '14', searchAuthor: 'captured author', searchSnapshot: 'captured-snapshot' };
const result = { code: [{ file: 'src/app.ts', startLine: 1, chunkUid: 'captured-chunk', score: 4,
  scoreBreakdown: { sparse: { score: 4 } } }], stats: { trust: { basis: 'captured-fixture' } } };

try {
  for (const transport of ['cli', 'api']) {
    const harness = createVsCodeRuntimeHarness({ repoRoot: first, activeFile: path.join(first, 'src', 'app.ts'),
      workspaceFolders: [{ path: first }, { path: second }], configValues: options,
      globalConfigValues: { cliPath: path.join(first, 'bin', 'pairofcleats.js'), cliArgs: ['--trace'],
        extraSearchArgs: ['--no-ann'], apiServerUrl: baseUrl, apiExecutionMode: transport === 'api' ? 'require' : 'cli' } });
    const mapping = transport === 'api' ? prepareServiceMappingFixture(harness, { repoRoot: first, baseUrl }) : null;
    try {
      harness.activate(); harness.inputQueue.push('captured query'); harness.quickPickQueue.push(null);
      if (transport === 'api') harness.queuedFetchResults.push({ json: { ok: true, runtimeManifest: getRuntimeCapabilityManifest() } },
        { json: mapping.status }, { json: { result } });
      else harness.queuedResults.push({ code: 0, stdout: JSON.stringify(result) });
      await harness.runCommand(`pairofcleats.${transport === 'cli' ? 'explainSearch' : 'search'}`);
      const captured = harness.workspaceStateStore.get('pairofcleats.searchHistory')[0];
      assert.equal(captured.invocation.request.options.modifiedSince, 14);
      assert.equal(Object.isFrozen(captured.invocation.request.options.extraArgs), true);
      const originalArgs = harness.spawnCalls[0]?.args;
      const originalPayload = transport === 'api' ? JSON.parse(harness.fetchCalls.at(-1).options.body) : null;
      captured.invocation.command = 'obsolete-or-untrusted.exe';
      captured.invocation.args = ['scripts/from-history.js'];
      if (transport === 'api') captured.invocation.payload.filter = 'file:wrong-target';
      harness.setConfiguration({ searchFilter: 'file:other.ts', searchModifiedSince: '0', searchSnapshot: '', searchMode: 'prose' });
      harness.setGlobalConfiguration({ cliPath: currentCli, cliArgs: ['--current-prefix'] });
      harness.setActiveFile(path.join(second, 'src', 'app.ts'));
      if (transport === 'api') harness.queuedFetchResults.push({ json: { ok: true, runtimeManifest: getRuntimeCapabilityManifest() } }, { json: { result } });
      else harness.queuedResults.push({ code: 0, stdout: JSON.stringify(result) });
      await harness.runCommand('pairofcleats.repeatLastSearch');
      if (transport === 'api') {
        assert.deepEqual(JSON.parse(harness.fetchCalls.at(-1).options.body), originalPayload,
          'saved API replay uses captured typed filters and the original service mapping');
      } else {
        assert.deepEqual(harness.spawnCalls.at(-1).args, [currentCli, '--current-prefix', ...originalArgs.slice(2)]);
        assert.equal(harness.spawnCalls.at(-1).options.cwd, first);
        assert.equal(harness.workspaceStateStore.get('pairofcleats.searchHistory')[0].hits[0].scoreBreakdown.sparse.score, 4);
      }
      assert.equal(harness.workspaceStateStore.get('pairofcleats.searchHistory').length, 2);
      assert.deepEqual(harness.errorMessages, []);

      const before = [harness.spawnCalls.length, harness.fetchCalls.length];
      harness.setGlobalConfiguration({ extraSearchArgs: ['--case'] });
      await harness.runCommand('pairofcleats.repeatLastSearch');
      assert.deepEqual([harness.spawnCalls.length, harness.fetchCalls.length], before);
      assert.match(harness.errorMessages.at(-1), /extra arguments changed/);
      harness.setGlobalConfiguration({ extraSearchArgs: ['--no-ann'],
        apiExecutionMode: transport === 'api' ? 'cli' : 'require' });
      await harness.runCommand('pairofcleats.repeatLastSearch');
      assert.deepEqual([harness.spawnCalls.length, harness.fetchCalls.length], before);
      assert.match(harness.errorMessages.at(-1), /Transport policy/);
    } finally { await harness.extension.deactivate(); harness.restoreGlobals(); }
  }
  const required = createVsCodeRuntimeHarness({ repoRoot: first, globalConfigValues: { cliPath: currentCli, apiExecutionMode: 'require' } });
  try {
    required.activate(); await required.runCommand('pairofcleats.openIndexDirectory');
    assert.equal(required.spawnCalls.length, 0);
    assert.match(required.errorMessages.at(-1), /API mode is not supported/);
  } finally { await required.extension.deactivate(); required.restoreGlobals(); }
} finally { for (const root of [first, second, installation]) fs.rmSync(root, { recursive: true, force: true }); }
console.log('Registered saved-search current CLI/API and exact semantic filter authority controls authored; execution deferred.');
