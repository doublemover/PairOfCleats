import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getRuntimeCapabilityManifest } from '../../../src/shared/runtime-capability-manifest.js';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';
import { prepareServiceMappingFixture } from '../../helpers/vscode/service-mapping-fixture.js';

// Registered service selection and search, using inert HTTP boundaries. These
// controls do not qualify a physical SSH/WSL/container host or a live service.
for (const scenario of ['unchanged', 'head-during-status', 'removed-root-during-status', 'saved-traversal',
  'head-during-query', 'head-during-response', 'head-before-continuation', 'changed-continuation-mapping']) {
  const root = createVsCodeRuntimeTempRepo({ prefix: 'poc-service-identity-await-' });
  let harness, mapping;
  const requests = [];
  harness = createVsCodeRuntimeHarness({ repoRoot: root, activeFile: path.join(root, 'src', 'app.ts'),
    globalConfigValues: { apiExecutionMode: 'require', apiServerUrl: 'http://127.0.0.1:4311' },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.includes('/capabilities')) return new Response(JSON.stringify({ ok: true, runtimeManifest: getRuntimeCapabilityManifest() }));
      if (url.includes('/status')) {
        if (scenario === 'head-during-status') fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'b'.repeat(40) + '\n');
        if (scenario === 'removed-root-during-status') harness.fakeVscode.workspace.workspaceFolders = [];
        return new Response(JSON.stringify(mapping.status));
      }
      if (scenario === 'head-during-response') fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'b'.repeat(40) + '\n');
      const continuation = scenario.endsWith('continuation') || scenario === 'changed-continuation-mapping';
      const result = continuation ? { code: [{ file: 'src/app.ts', chunkUid: 'original-hit' }],
        pagination: { kind: 'filter', order: 'indexed-order', generation: 'a'.repeat(64), total: 2, returned: 1,
          hasMore: true, nextCursor: 'original-next' } } : { code: [] };
      return new Response(JSON.stringify({ ok: true, result }));
    } });
  mapping = prepareServiceMappingFixture(harness, { repoRoot: root, serviceRoot: '/srv/雪 project' });
  if (scenario === 'saved-traversal') {
    const saved = harness.workspaceStateStore.get('pairofcleats.serviceRepositories');
    Object.values(saved)[0].serviceRoot = '/srv/project/../other';
  }
  try {
    harness.activate(); harness.inputQueue.push('known source');
    if (scenario === 'head-during-query') harness.fakeVscode.window.showInputBox = async () => {
      fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'b'.repeat(40) + '\n'); return 'known source';
    };
    const continuation = scenario === 'head-before-continuation' || scenario === 'changed-continuation-mapping';
    if (continuation) { harness.inputQueue.length = 0; harness.inputQueue.push('lang:typescript'); }
    await harness.runCommand(continuation ? 'pairofcleats.browseIndexedMatches' : 'pairofcleats.search');
    const dispatched = ['unchanged', 'head-during-response'].includes(scenario) || continuation;
    assert.equal(requests.filter(item => item.url.endsWith('/search')).length, dispatched ? 1 : 0, scenario);
    if (scenario === 'unchanged' || continuation) {
      const invocation = harness.workspaceStateStore.get('pairofcleats.searchHistory')[0].invocation;
      assert.equal(invocation.payload.repo, '/srv/雪 project', 'service root remains distinct from editor host path');
      if (continuation) {
        const previous = harness.workspaceStateStore.get('pairofcleats.searchHistory')[0];
        if (scenario === 'head-before-continuation') fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'b'.repeat(40) + '\n');
        else Object.values(harness.workspaceStateStore.get('pairofcleats.serviceRepositories'))[0].serviceRoot = '/srv/another';
        await harness.runCommand('pairofcleats.loadMoreResults');
        assert.equal(requests.filter(item => item.url.endsWith('/search')).length, 1, 'saved continuation refuses a replaced source/mapping before dispatch');
        assert.equal(harness.workspaceStateStore.get('pairofcleats.searchHistory')[0].resultSetId, previous.resultSetId);
        assert(harness.errorMessages.some(message => /identity changed|mapping changed/.test(message)));
      }
    } else {
      assert(harness.errorMessages.some(message => /identity changed|traversal/.test(message)), scenario);
      assert.equal(harness.workspaceStateStore.get('pairofcleats.searchHistory'), undefined, 'replaced source identity never publishes history');
    }
    if (scenario === 'saved-traversal') assert.equal(requests.some(item => item.url.includes('/status')), false);
  } finally {
    await harness.extension.deactivate(); harness.restoreGlobals(); fs.rmSync(root, { recursive: true, force: true });
  }
}
console.log('Registered mapping status-await revision/root fencing and persisted path admission authored; real topology acceptance separate.');
