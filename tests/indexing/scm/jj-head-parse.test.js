#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  parseJjHeadOutput,
  parseJjJsonLines
} from '../../../src/index/scm/providers/jj-parse.js';

const output = [
  '{"commit_id":"abc123","change_id":"def456","author":"Ada","timestamp":"2026-01-01T00:00:00Z"}',
  'not-json'
].join('\n');

const rows = parseJjJsonLines(output);
assert.equal(rows.length, 1);
assert.equal(rows[0].commit_id, 'abc123');
assert.equal(rows[0].change_id, 'def456');
assert.equal(rows[0].author, 'Ada');
assert.equal(rows[0].timestamp, '2026-01-01T00:00:00Z');

const parsedHead = parseJjHeadOutput({
  logOutput: output,
  bookmarksOutput: '[beta alpha alpha]'
});
assert.equal(parsedHead.commitId, 'abc123');
assert.equal(parsedHead.changeId, 'def456');
assert.equal(parsedHead.author, 'Ada');
assert.equal(parsedHead.timestamp, '2026-01-01T00:00:00Z');
assert.deepEqual(parsedHead.bookmarks, ['alpha', 'beta']);

const emptyHead = parseJjHeadOutput({
  logOutput: 'not-json',
  bookmarksOutput: ''
});
assert.equal(emptyHead.commitId, null);
assert.equal(emptyHead.changeId, null);
assert.equal(emptyHead.author, null);
assert.equal(emptyHead.timestamp, null);
assert.equal(emptyHead.bookmarks, null);

console.log('jj head parse ok');
