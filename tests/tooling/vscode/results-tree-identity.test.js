import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createVsCodeRuntimeHarness } from '../../helpers/vscode/runtime-harness.js';
const require = createRequire(import.meta.url);
const { resultTreeItemId, resultTreeHitOccurrences } = require('../../../extensions/vscode/results-tree-identity.js');
const scope = { resultSetId: 'captured-browse', kind: 'hit', ordinal: 0 };
const numeric = { section: 'records', id: 0, name: 'same' };
const original = resultTreeItemId({ ...scope, hit: numeric });
assert.equal(resultTreeItemId({ ...scope, ordinal: 99, groupMode: 'file', hit: { ...numeric, name: 'new display' } }), original,
  'canonical identity survives display/group order changes without becoming a new source join');
for (const hit of [{ section: 'records', id: '0', name: 'same' },
  { section: 'records', chunkUid: '0', name: 'same' }, { section: 'code', id: 0, name: 'same' }]) {
  assert.notEqual(resultTreeItemId({ ...scope, hit }), original);
}
assert.notEqual(resultTreeItemId({ ...scope, hit: numeric, resultSetId: 'new-explicit-browse' }), original);
assert.notEqual(resultTreeItemId({ ...scope, hit: { file: 'unknown.js' } }),
  resultTreeItemId({ ...scope, hit: { file: 'unknown.js' }, ordinal: 1 }), 'unknown IDs do not collapse by spelling/path');
assert.notEqual(resultTreeItemId({ ...scope, kind: 'group', key: 'same', groupMode: 'file' }),
  resultTreeItemId({ ...scope, kind: 'group', key: 'same', groupMode: 'section' }));
assert.equal(resultTreeItemId({ ...scope, hit: { file: 'unknown.js' }, ordinal: null }), null);
const repeated = [numeric, { ...numeric, name: 'duplicate display' }, { section: 'code', id: 0 }];
const occurrences = resultTreeHitOccurrences(repeated);
assert.deepEqual(occurrences, [0, 1, 0]);
assert.deepEqual(resultTreeHitOccurrences([...repeated, numeric]), [0, 1, 0, 2]);
const displayIds = repeated.map((hit, ordinal) => resultTreeItemId({ ...scope, hit, ordinal, occurrence: occurrences[ordinal] }));
assert.equal(new Set(displayIds).size, repeated.length, 'repeated canonical members still have unique native TreeItem IDs');
assert.equal(displayIds[0], original, 'appending a duplicate does not rename the existing native item');
const historyHits = [...repeated.map(hit => ({ ...hit, file: 'src/identical.js' })),
  { section: 'code', file: 'src/anonymous.js' }, { section: 'records', file: 'src/anonymous.js' }];
const harness = createVsCodeRuntimeHarness({ repoRoot: process.cwd(), workspaceState: {
  'pairofcleats.searchHistory': [{ resultSetId: scope.resultSetId, repoRoot: process.cwd(), query: 'saved', hits: historyHits }],
  'pairofcleats.searchResults.active': scope.resultSetId
} });
try {
  harness.activate();
  const readItems = () => harness.treeProviders[0].getChildren().flatMap(group => group.children.map(node => node.treeItem));
  const before = readItems().map(item => item.id).sort();
  assert.equal(new Set(before).size, historyHits.length);
  for (const command of ['pairofcleats.groupResultsByFile', 'pairofcleats.groupResultsByQuery', 'pairofcleats.groupResultsBySection']) {
    await harness.runCommand(command);
    assert.deepEqual(readItems().map(item => item.id).sort(), before,
      'registered native grouping uses source-order occurrences instead of group-local positions');
    assert(harness.treeProviders[0].getChildren().every(group => typeof group.treeItem.id === 'string'));
  }
  assert.equal(harness.spawnCalls.length, 0); assert.equal(harness.fetchCalls.length, 0);
} finally { await harness.extension.deactivate(); harness.restoreGlobals(); }
console.log('Native tree display identity preserves exact hit domains and captured unknown ordinals');
