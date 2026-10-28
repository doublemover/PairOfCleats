#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  resolveRecordArtifactPathSafe,
  resolveRecordPathSafe
} from '../../../tools/triage/context-pack-paths.js';

const recordsDir = path.resolve('tmp-records');

assert.equal(
  resolveRecordPathSafe(recordsDir, 'finding-123'),
  path.resolve(recordsDir, 'finding-123.json'),
  'expected simple record ids to resolve under records dir'
);
assert.equal(
  resolveRecordPathSafe(recordsDir, '..finding-123'),
  path.resolve(recordsDir, '..finding-123.json'),
  'expected dotdot-prefixed in-dir ids to resolve under records dir'
);
assert.equal(
  resolveRecordPathSafe(recordsDir, '../outside'),
  null,
  'expected traversal record ids to be rejected'
);
assert.equal(
  resolveRecordPathSafe(recordsDir, 'nested/id'),
  null,
  'expected slash-containing record ids to be rejected'
);
assert.equal(
  resolveRecordPathSafe(recordsDir, ''),
  null,
  'expected empty record ids to be rejected'
);
assert.equal(
  resolveRecordArtifactPathSafe(recordsDir, 'finding-123', '.md'),
  path.resolve(recordsDir, 'finding-123.md'),
  'expected artifact extension override to resolve correctly'
);

for (const id of [null, 123, {}, ' leading', 'trailing ', '\0inside', 'nested\\id']) {
  assert.equal(resolveRecordPathSafe(recordsDir, id), null, 'IDs must remain canonical strings without aliases or path syntax');
}
for (const extension of ['../outside', '.json/nested', '.json\\nested', '\0json', {}]) {
  assert.equal(resolveRecordArtifactPathSafe(recordsDir, 'finding-123', extension), null);
}
for (const id of ['..finding-123', '.hidden-finding', 'Unicode-界😀', 'console-result', 'COM10', 'LPT10', 'null-result']) {
  assert.equal(resolveRecordPathSafe(recordsDir, id), path.resolve(recordsDir, id + '.json'),
    'ordinary authored IDs, Unicode and reserved-name lookalikes stay supported');
}
if (process.platform === 'win32') {
  for (const id of ['stream:payload', 'file::$DATA', 'NUL', 'nul.txt', 'CON', 'con.extra', 'CON .extra',
    'PRN', 'AUX', 'COM1', 'com9.extra', 'COM¹', 'COM²', 'LPT³', 'LPT9', 'quote"id', 'wild*id',
    'question?id', 'pipe|id', 'angle<id', 'other>id', 'control\u0001id', 'newline\nid']) {
    assert.equal(resolveRecordPathSafe(recordsDir, id), null, `Windows rejects ${JSON.stringify(id)} before native IO`);
    assert.equal(resolveRecordArtifactPathSafe(recordsDir, id, '.md'), null);
  }
  assert.equal(resolveRecordPathSafe(recordsDir, 'x'.repeat(251)), null);
  assert.equal(resolveRecordArtifactPathSafe(recordsDir, 'x'.repeat(251), '.md'), path.resolve(recordsDir, 'x'.repeat(251) + '.md'));
  assert.equal(resolveRecordArtifactPathSafe(recordsDir, 'x'.repeat(253), '.md'), null);
  for (const extension of [':stream', '.json::$DATA', '.md ', '.md.', '.bad?', '.bad\u001fid']) {
    assert.equal(resolveRecordArtifactPathSafe(recordsDir, 'ordinary', extension), null, 'extension cannot reintroduce device/stream syntax');
  }
}

console.log('triage context-pack path safety test passed');
