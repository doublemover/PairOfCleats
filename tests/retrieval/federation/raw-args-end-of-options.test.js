#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildPerRepoArgsFromCli } from '../../../src/retrieval/federation/args.js';

const args = buildPerRepoArgsFromCli({
  rawArgs: [
    'query-token',
    '--workspace',
    'workspace.jsonc',
    '--top',
    '9',
    '--',
    '--tag',
    '--top',
    '-n',
    '--repo-filter'
  ],
  perRepoTop: 7
});

const marker = args.indexOf('--');
assert.ok(marker > -1, 'expected end-of-options marker to be preserved');

const optionTokens = args.slice(0, marker);
const positionalTokens = args.slice(marker + 1);

assert.equal(optionTokens.includes('--workspace'), false, 'workspace flag must be stripped from option section');
assert.deepEqual(
  positionalTokens,
  ['--tag', '--top', '-n', '--repo-filter'],
  'flag-like query tokens after -- must remain verbatim'
);
assert.equal(
  optionTokens.filter((token) => token === '--top').length,
  1,
  'expected exactly one injected --top option before --'
);
assert.equal(
  optionTokens[optionTokens.length - 2],
  '--top',
  'injected --top should be appended in option section'
);
assert.equal(optionTokens[optionTokens.length - 1], '7', 'injected --top value should match perRepoTop');
assert.equal(optionTokens.includes('--json'), true, 'expected --json option to be enforced before --');

assert.doesNotThrow(() => buildPerRepoArgsFromCli({
  rawArgs: [
    'query-token',
    '--workspace',
    'workspace.jsonc',
    '--',
    '--top',
    '--top'
  ],
  perRepoTop: 7
}), 'duplicate top detection should ignore tokens after --');

console.log('federated raw args end-of-options test passed');
