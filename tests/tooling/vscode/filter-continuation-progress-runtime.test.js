import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getRuntimeCapabilityManifest } from '../../../src/shared/runtime-capability-manifest.js';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';
import { prepareServiceMappingFixture } from '../../helpers/vscode/service-mapping-fixture.js';

// Registered CLI/API consumers with inert transport boundaries. Authored only;
// no extension host, child, server, native/runtime or IPC execution was run.
const generation = 'a'.repeat(64);
const page = (chunkUid, nextCursor) => ({ code: [{ file: 'src/app.ts', chunkUid, startLine: 1 }],
  pagination: { kind: 'filter', order: 'indexed-order', generation, total: 6, returned: 1,
    hasMore: true, nextCursor, coverage: 'indexed-metadata' } });
for (const transport of ['cli', 'api']) {
  const repoRoot = createVsCodeRuntimeTempRepo({ prefix: 'editor-continuation-progress-' });
  const harness = createVsCodeRuntimeHarness({ repoRoot, configValues: { searchMode: 'code' },
    globalConfigValues: { apiExecutionMode: transport === 'api' ? 'require' : 'cli', apiServerUrl: 'http://127.0.0.1:4311' } });
  const mapping = transport === 'api' ? prepareServiceMappingFixture(harness, { repoRoot }) : null;
  const enqueue = (payload, initial = false) => {
    if (transport === 'api') {
      if (initial) harness.queuedFetchResults.push({ json: { ok: true, runtimeManifest: getRuntimeCapabilityManifest() } }, { json: mapping.status });
      harness.queuedFetchResults.push({ json: { ok: true, result: payload } });
    } else harness.queuedResults.push({ code: 0, stdout: JSON.stringify(payload) });
  };
  const history = () => harness.workspaceStateStore.get('pairofcleats.searchHistory')[0];
  try {
    harness.activate(); enqueue(page('one', 'cursor-a'), true);
    await harness.extension._test.executeSearchCommand({ enumeration: true, optionOverrides: { filter: 'lang:javascript' } });
    const original = history(), provider = harness.treeProviders[0];
    const itemId = provider.getChildren()[0].children[0].treeItem.id;
    enqueue(page('two', 'cursor-b')); await harness.runCommand('pairofcleats.loadMoreResults');
    assert.deepEqual(history().hits.map(hit => hit.chunkUid), ['one', 'two']);
    assert.equal(history().resultSetId, original.resultSetId); assert.equal(history().pagination.nextCursor, 'cursor-b');

    for (const [incoming, diagnostic] of [[page('three', 'cursor-a'), /earlier cursor/], [page('one', 'cursor-c'), /no new source identities/]]) {
      const errors = harness.errorMessages.length;
      enqueue(incoming); await harness.runCommand('pairofcleats.loadMoreResults');
      assert.match(harness.errorMessages.slice(errors).join('\n'), diagnostic, transport);
      assert.deepEqual(history().hits.map(hit => hit.chunkUid), ['one', 'two']);
      assert.equal(history().pagination.nextCursor, 'cursor-b'); assert.equal(history().resultSetId, original.resultSetId);
      assert.equal(provider.getChildren()[0].children[0].treeItem.id, itemId,
        'refused continuation retains stable native focus/source membership');
    }
    enqueue(page('three', 'cursor-c')); await harness.runCommand('pairofcleats.loadMoreResults');
    assert.deepEqual(history().hits.map(hit => hit.chunkUid), ['one', 'two', 'three']);
    enqueue(page('four', 'cursor-a')); await harness.runCommand('pairofcleats.loadMoreResults');
    assert.match(harness.errorMessages.at(-1), /earlier cursor/);
    assert.deepEqual(history().hits.map(hit => hit.chunkUid), ['one', 'two', 'three']);
    assert.equal(history().pagination.nextCursor, 'cursor-c');
  } finally {
    await harness.extension.deactivate(); harness.restoreGlobals();
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}
console.log('Registered CLI/API continuation progress/refusal/native identity controls authored; execution deferred.');
