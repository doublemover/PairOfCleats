#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseJjJsonLines } from '../../../src/index/scm/providers/jj-parse.js';
import { skip } from '../../helpers/skip.js';

const jjCheck = spawnSync('jj', ['--version'], { encoding: 'utf8' });
if (jjCheck.status !== 0) {
  skip('jj unavailable; skipping jj parse tests');
}

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
