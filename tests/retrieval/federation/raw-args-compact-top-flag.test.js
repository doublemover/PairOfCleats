#!/usr/bin/env node
import assert from 'node:assert/strict';
import { parseSearchArgs } from '../../../src/retrieval/cli-args.js';
import { buildPerRepoArgsFromCli } from '../../../src/retrieval/federation/args.js';

const perRepoTop = 7;
const args = buildPerRepoArgsFromCli({
  rawArgs: [
    'query-token',
    '--workspace',
    'workspace.jsonc',
    '-n10'
  ],
  perRepoTop
});

assert.equal(args.includes('-n10'), false, 'compact -n10 should be removed before per-repo forwarding');
assert.equal(
  args.filter((token) => token === '--top').length,
  1,
  'exactly one top flag should remain after forwarding rewrite'
);
assert.equal(args.includes('--json'), true, 'json output should be enforced for federated per-repo calls');

const parsed = parseSearchArgs(args);
assert.equal(Array.isArray(parsed.top), false, 'top should remain scalar after rewrite');
assert.equal(Array.isArray(parsed.n), false, 'n alias should remain scalar after rewrite');
assert.equal(Number(parsed.top), perRepoTop, 'rewritten top value should match perRepoTop');

assert.throws(
  () => buildPerRepoArgsFromCli({
    rawArgs: [
      'query-token',
      '--workspace',
      'workspace.jsonc',
      '-n10',
      '--top',
      '5'
    ],
    perRepoTop
  }),
  /multiple --top values/i,
  'compact -n10 should count as a top flag for duplicate detection'
);

console.log('federated raw args compact top flag test passed');
