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

console.log('triage context-pack path safety test passed');
