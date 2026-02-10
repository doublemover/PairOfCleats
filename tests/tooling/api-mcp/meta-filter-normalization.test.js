#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizeMetaFilters } from '../../../tools/shared/search-request.js';
import { buildSearchParams } from '../../../tools/api/router/search.js';
import { buildMcpSearchArgs } from '../../../tools/mcp/tools/search-args.js';

const collectFlagValues = (args, flag) => {
  const values = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== flag) continue;
    values.push(args[i + 1]);
    i += 1;
  }
  return values;
};

const metaInput = [{ owner: 'me' }, 'tag', { blank: '' }, 42, true];
const normalized = normalizeMetaFilters(metaInput);
assert.deepEqual(
  normalized,
  ['owner=me', 'tag', 'blank', '42', 'true']
);

const apiResult = buildSearchParams('/repo', {
  query: 'needle',
  meta: metaInput
}, 'compact');
assert.equal(apiResult.ok, true);

const mcpArgs = buildMcpSearchArgs({
  repoPath: '/repo',
  query: 'needle',
  meta: metaInput
});

const apiMeta = collectFlagValues(apiResult.args, '--meta');
const mcpMeta = collectFlagValues(mcpArgs, '--meta');
assert.deepEqual(apiMeta, normalized);
assert.deepEqual(mcpMeta, normalized);

console.log('meta filter normalization test passed');
