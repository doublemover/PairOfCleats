#!/usr/bin/env node
import assert from 'node:assert/strict';
import { parseJjJsonLines } from '../../../src/index/scm/providers/jj-parse.js';

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

console.log('jj head parse ok');
