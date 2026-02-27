#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseSeedRef } from '../../../src/shared/seed-ref.js';

const assertThrows = (label, fn, message) => {
  try {
    fn();
  } catch (err) {
    assert.equal(err?.message, message, `${label} message`);
    return;
  }
  console.error(`${label} expected an error`);
  process.exit(1);
};

const repoRoot = path.resolve('repo-root');

assert.deepEqual(parseSeedRef('chunk:abc123', repoRoot), {
  type: 'chunk',
  chunkUid: 'abc123'
});

assert.deepEqual(parseSeedRef('symbol:MySymbol', repoRoot), {
  type: 'symbol',
  symbolId: 'MySymbol'
});

assert.deepEqual(parseSeedRef('file:src/index.js', repoRoot), {
  type: 'file',
  path: 'src/index.js'
});

const absPath = path.join(repoRoot, 'src', 'main.js');
assert.deepEqual(parseSeedRef(`file:${absPath}`, repoRoot), {
  type: 'file',
  path: 'src/main.js'
});

assertThrows(
  'missing seed',
  () => parseSeedRef('', repoRoot),
  'Missing --seed value.'
);

assertThrows(
  'invalid seed',
  () => parseSeedRef('file', repoRoot),
  'Invalid --seed value. Use chunk:<id>, symbol:<id>, or file:<path>.'
);

assertThrows(
  'outside repo',
  () => parseSeedRef('file:../outside.js', repoRoot),
  'file: seeds must resolve to a repo-relative path.'
);

console.log('seed ref parsing ok');
