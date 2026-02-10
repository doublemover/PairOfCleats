#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildSearchParams } from '../../../tools/api/router/search.js';
import { buildMcpSearchArgs } from '../../../tools/mcp/tools/search-args.js';

const containsSequence = (args, sequence) => {
  const index = args.findIndex((_value, i) => sequence.every((entry, j) => args[i + j] === entry));
  return index !== -1;
};

const normalizeMcpArgs = (args) => {
  const normalized = [];
  for (let i = 0; i < args.length; i += 1) {
    const value = args[i];
    if (value === '--repo') {
      i += 1;
      continue;
    }
    if (value === '-n') {
      normalized.push('--top');
      continue;
    }
    normalized.push(value);
  }
  return normalized;
};

const payload = {
  query: 'needle',
  mode: 'code',
  backend: 'sqlite',
  ann: true,
  top: 5,
  context: 2,
  type: 'function',
  riskTag: 'command-exec',
  modifiedSince: 7,
  path: ['src/', 'tools/'],
  file: ['index.js'],
  ext: ['.js'],
  lang: 'javascript',
  meta: { team: 'alpha' },
  metaJson: { env: 'prod' },
  caseFile: true
};

const apiResult = buildSearchParams('/repo', payload, 'compact');
assert.equal(apiResult.ok, true);

const mcpArgs = buildMcpSearchArgs({ ...payload, repoPath: '/repo', output: 'compact' });
const normalizedMcp = normalizeMcpArgs(mcpArgs);
assert.deepEqual(normalizedMcp, apiResult.args, 'API and MCP search argv should match for shared fields');

const apiPathAliasResult = buildSearchParams('/repo', {
  query: 'needle',
  paths: ['src/a.js', 'src/b.js'],
  filter: 'risk:high'
}, 'compact');
assert.equal(apiPathAliasResult.ok, true);
assert.equal(containsSequence(apiPathAliasResult.args, ['--path', 'src/a.js']), true);
assert.equal(containsSequence(apiPathAliasResult.args, ['--path', 'src/b.js']), true);
assert.equal(containsSequence(apiPathAliasResult.args, ['--filter', 'risk:high']), true);

console.log('search request parity test passed');
