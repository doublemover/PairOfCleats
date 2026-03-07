#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createCommentAwareLineStripper,
  stripInlineCommentAware
} from '../../../src/index/language-registry/import-collectors/comment-aware.js';
import { addCollectorImport } from '../../../src/index/language-registry/import-collectors/utils.js';

const hashStripper = createCommentAwareLineStripper({
  markers: ['#'],
  requireWhitespaceBefore: true
});
assert.equal(
  hashStripper('include = "value#fragment" # trailing comment'),
  'include = "value#fragment"'
);
assert.equal(hashStripper('include = value#fragment'), 'include = value#fragment');

const slashStripper = createCommentAwareLineStripper({
  markers: ['//'],
  requireWhitespaceBefore: true
});
assert.equal(
  slashStripper('@using System.Text // trailing'),
  '@using System.Text'
);
assert.equal(
  slashStripper('url = "https://example.com/path"'),
  'url = "https://example.com/path"'
);

const blockStripper = createCommentAwareLineStripper({
  markers: ['//'],
  blockCommentPairs: [['/*', '*/']],
  requireWhitespaceBefore: true
});
assert.equal(blockStripper('/* start comment'), '');
assert.equal(blockStripper('still comment */ import "real.proto";'), ' import "real.proto";');
assert.equal(blockStripper('import "next.proto"; // trailing'), 'import "next.proto";');

assert.equal(
  stripInlineCommentAware('name = "pkg#name" # trailing', { markers: ['#'], requireWhitespaceBefore: true }),
  'name = "pkg#name"'
);

const imports = new Set();
assert.equal(addCollectorImport(imports, 'anchor:token'), false);
assert.equal(addCollectorImport(imports, '  ./real/path  '), true);
assert.deepEqual(Array.from(imports), ['./real/path']);

console.log('collector utils comment-aware test passed');
