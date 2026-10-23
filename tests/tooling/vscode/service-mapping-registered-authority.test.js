import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getRuntimeCapabilityManifest } from '../../../src/shared/runtime-capability-manifest.js';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';
import { prepareServiceMappingFixture } from '../../helpers/vscode/service-mapping-fixture.js';

// Registered service selection and search, using inert HTTP boundaries. These
// controls do not qualify a physical SSH/WSL/container host or a live service.
for (const scenario of ['unchanged', 'head-during-status', 'removed-root-during-status', 'saved-traversal']) {
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
      return new Response(JSON.stringify({ ok: true, result: { code: [] } }));
    } });
  mapping = prepareServiceMappingFixture(harness, { repoRoot: root, serviceRoot: '/srv/雪 project' });
  if (scenario === 'saved-traversal') {
    const saved = harness.workspaceStateStore.get('pairofcleats.serviceRepositories');
    Object.values(saved)[0].serviceRoot = '/srv/project/../other';
  }
  try {
    harness.activate(); harness.inputQueue.push('known source');
    await harness.runCommand('pairofcleats.search');
    assert.equal(requests.filter(item => item.url.endsWith('/search')).length, scenario === 'unchanged' ? 1 : 0, scenario);
    if (scenario === 'unchanged') {
      const invocation = harness.workspaceStateStore.get('pairofcleats.searchHistory')[0].invocation;
      assert.equal(invocation.payload.repo, '/srv/雪 project', 'service root remains distinct from editor host path');
    } else assert(harness.errorMessages.some(message => /identity changed|traversal/.test(message)), scenario);
    if (scenario === 'saved-traversal') assert.equal(requests.some(item => item.url.includes('/status')), false);
  } finally {
    await harness.extension.deactivate(); harness.restoreGlobals(); fs.rmSync(root, { recursive: true, force: true });
  }
}
console.log('Registered mapping status-await revision/root fencing and persisted path admission authored; real topology acceptance separate.');
