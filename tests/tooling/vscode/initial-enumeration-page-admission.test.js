import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getRuntimeCapabilityManifest } from '../../../src/shared/runtime-capability-manifest.js';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';
import { prepareServiceMappingFixture } from '../../helpers/vscode/service-mapping-fixture.js';

const generation = 'a'.repeat(64);
const page = { kind: 'filter', order: 'indexed-order', generation, total: 2, returned: 1, hasMore: true, nextCursor: 'opaque' };
const invalidPages = [undefined, { ...page, generation: 'stale' }, { ...page, returned: 0 },
  { ...page, total: 0 }, { ...page, hasMore: false }, { ...page, order: 'score' }];
for (const transport of ['cli', 'api']) {
  const repoRoot = createVsCodeRuntimeTempRepo({ prefix: 'editor-initial-filter-page-' });
  const original = { resultSetId: 'retained', repoRoot, query: 'previous explicit search', mode: 'code',
    hits: [{ section: 'code', file: 'src/app.ts', chunkUid: 'previous', startLine: 1 }], totalHits: 1 };
  const harness = createVsCodeRuntimeHarness({ repoRoot, configValues: { searchMode: 'code' },
    globalConfigValues: { apiExecutionMode: transport === 'api' ? 'require' : 'cli', apiServerUrl: 'http://127.0.0.1:4311' },
    workspaceState: { 'pairofcleats.searchHistory': [original], 'pairofcleats.searchResults.active': original.resultSetId } });
  const mapping = transport === 'api' ? prepareServiceMappingFixture(harness, { repoRoot }) : null;
  try {
    harness.activate();
    for (const pagination of invalidPages) {
      const payload = { code: [{ file: 'src/app.ts', chunkUid: 'incoming', startLine: 1 }], pagination };
      if (transport === 'api') {
        if (!harness.fetchCalls.length) harness.queuedFetchResults.push({ json: { ok: true, runtimeManifest: getRuntimeCapabilityManifest() } });
        harness.queuedFetchResults.push({ json: mapping.status }, { json: { ok: true, result: payload } });
      } else harness.queuedResults.push({ code: 0, stdout: JSON.stringify(payload) });
      const errorsBefore = harness.errorMessages.length;
      await harness.extension._test.executeSearchCommand({ enumeration: true, optionOverrides: { filter: 'lang:javascript' } });
      assert(harness.errorMessages.length > errorsBefore, `${transport} invalid initial page reports refusal`);
      assert.equal(harness.workspaceStateStore.get('pairofcleats.searchHistory').length, 1);
      assert.equal(harness.workspaceStateStore.get('pairofcleats.searchResults.active'), original.resultSetId);
      const root = harness.treeProviders[0].getChildren()[0];
      assert.equal(root.children[0].hit.chunkUid, 'previous', 'invalid initial page cannot replace the visible captured source');
    }
  } finally {
    await harness.extension.deactivate(); harness.restoreGlobals();
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}
console.log('Registered CLI/API initial indexed-page admission preserves prior history, native view and source membership on refusal');
