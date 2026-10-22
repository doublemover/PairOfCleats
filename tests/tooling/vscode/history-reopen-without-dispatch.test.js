import assert from 'node:assert/strict';
import { createVsCodeRuntimeHarness } from '../../helpers/vscode/runtime-harness.js';

const repoRoot = process.cwd();
const saved = (id, query, file, invocation) => ({
  resultSetId: id, query, repoRoot, repoUri: 'vscode-remote:/saved/repository',
  createdAt: '2026-10-21T00:00:00.000Z', mode: 'code', backend: 'sqlite',
  totalHits: 1, hits: [{ file, section: 'code', startLine: 1, score: 2 }], invocation
});
const older = saved('older', 'historical query', 'src/old.js', {
  kind: 'api-search', baseUrl: 'http://127.0.0.1:4311', timeoutMs: 5000,
  payload: { query: 'historical query', repo: repoRoot, mode: 'code' }
});
const newer = saved('newer', 'recent query', 'src/new.js', null);
const harness = createVsCodeRuntimeHarness({ repoRoot,
  workspaceState: { 'pairofcleats.searchHistory': [newer, older], 'pairofcleats.searchResults.active': 'newer' }
});
try {
  harness.activate();
  await harness.runCommand('pairofcleats.reopenLastResults');
  const before = structuredClone(harness.workspaceStateStore.get('pairofcleats.searchHistory'));
  harness.quickPickQueue.push(items => items.find(item => item.resultSet.resultSetId === 'older'));
  await harness.runCommand('pairofcleats.showSearchHistory');
  assert.equal(harness.spawnCalls.length, 0);
  assert.equal(harness.fetchCalls.length, 0);
  assert.equal(harness.workspaceStateStore.get('pairofcleats.searchResults.active'), 'older');
  assert.deepEqual(harness.workspaceStateStore.get('pairofcleats.searchHistory'), before);
  const group = harness.treeProviders[0].getChildren()[0];
  assert.equal(group.children[0].hit.file, 'src/old.js');
  assert.equal(group.children[0].resultSet.repoUri, older.repoUri);
  assert.ok(harness.infoMessages.some(message => /saved evidence from 2026-10-21/.test(message)));

  await harness.runCommand('pairofcleats.reopenLastResults');
  assert.equal(harness.fetchCalls.length, 0);
  assert.deepEqual(harness.workspaceStateStore.get('pairofcleats.searchHistory'), before);

  harness.queuedFetchResults.push({ status: 200, json: { code: [{ file: 'src/fresh.js', startLine: 1 }] } });
  await harness.runCommand('pairofcleats.repeatLastSearch');
  assert.equal(harness.fetchCalls.length, 1, 'only explicit repeat dispatches');
  assert.equal(harness.workspaceStateStore.get('pairofcleats.searchHistory').length, 3);
  assert.equal(harness.workspaceStateStore.get('pairofcleats.searchHistory').find(entry => entry.resultSetId === 'older').hits[0].file, 'src/old.js');
} finally {
  harness.restoreGlobals();
}
console.log('Saved search history reopens the original identity and hits without backend dispatch.');
