#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildSearchParams } from '../../../tools/api/router/search.js';
import { buildMcpSearchArgs } from '../../../tools/mcp/tools/search-args.js';
import { getSearchRequestSchema, createSearchValidator } from '../../../tools/api/validation.js';
import { getToolDefs } from '../../../src/integrations/mcp/defs.js';
import { buildSearchRequestProperties } from '../../../src/shared/search-request-schema.js';
import { createAjv, compileSchema } from '../../../src/shared/validation/ajv-factory.js';

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
  allowSparseFallback: true,
  allowUnsafeMix: true,
  top: 5,
  context: 0,
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
assert.equal(buildSearchParams('/repo', { ...payload, context: 2 }, 'compact').ok, false,
  'removed context lines are rejected before dispatch');
assert.throws(() => buildMcpSearchArgs({ ...payload, context: 2, repoPath: '/repo' }), /context/i);

const apiPathAliasResult = buildSearchParams('/repo', {
  query: 'needle',
  paths: ['src/a.js', 'src/b.js'],
  filter: 'risk:high'
}, 'compact');
assert.equal(apiPathAliasResult.ok, true);
assert.equal(containsSequence(apiPathAliasResult.args, ['--path', 'src/a.js']), true);
assert.equal(containsSequence(apiPathAliasResult.args, ['--path', 'src/b.js']), true);
assert.equal(containsSequence(apiPathAliasResult.args, ['--filter', 'risk:high']), true);

// UNVALIDATED extension: actual advertised schemas and shared argv producers.
const mcpSchema = getToolDefs('fixture-model').find(tool => tool.name === 'search').inputSchema;
const httpSchema = getSearchRequestSchema(), validateHttp = createSearchValidator();
const validateMcp = compileSchema(createAjv({ strict: false }), mcpSchema);
const validateHttpDomain = compileSchema(createAjv({ strict: false }), httpSchema);
const base = { query: 'needle' };
assert.equal(validateMcp(base), true); assert.equal(validateHttp(base).ok, true);
const corpus = [
  ...['path', 'paths', 'file', 'ext'].flatMap(field => [
    { field, value: 'src/', valid: true }, { field, value: ['src/', 'lib/'], valid: true },
    { field, value: [], valid: true }, { field, value: null, valid: false },
    { field, value: [1], valid: false }, { field, value: {}, valid: false }
  ]),
  ...['auto', 'memory', 'sqlite', 'sqlite-fts', 'lmdb'].map(value => ({ field: 'backend', value, valid: true })),
  ...[null, '', 'invented'].map(value => ({ field: 'backend', value, valid: false })),
  ...['top', 'branchesMin', 'loopsMin', 'breaksMin', 'continuesMin', 'churnMin', 'modifiedSince'].flatMap(field => [
    { field, value: 0, valid: true }, { field, value: 2, valid: true },
    ...[-1, .5, null, '2', [], {}].map(value => ({ field, value, valid: false }))
  ]),
  ...['team=infra', { team: 'infra' }, ['team=infra', 'env=prod'], [0, false, null, { team: 'infra' }], []]
    .map(value => ({ field: 'meta', value, valid: true })),
  ...[null, false, 1].map(value => ({ field: 'meta', value, valid: false })),
  ...['{"team":"infra"}', { team: 'infra' }, ['team=infra'], null, false, 0]
    .map(value => ({ field: 'metaJson', value, valid: true })),
  { field: 'context', value: 0, valid: true },
  ...[null, 1, -1, .5, '0'].map(value => ({ field: 'context', value, valid: false })),
  ...[true, false].map(value => ({ field: 'ann', value, valid: true })),
  ...[null, 0, 'false'].map(value => ({ field: 'ann', value, valid: false })),
  { field: 'unknown', value: 'value', valid: false }
];
for (const { field, value, valid } of corpus) {
  const input = { ...base, [field]: value }, label = `${field}: ${JSON.stringify(value)}`;
  assert.equal(validateMcp(input), valid, `MCP advertised value domain ${label}`);
  assert.equal(validateHttp(input).ok, valid, `HTTP actual request admission ${label}`);
  if (valid) {
    const api = buildSearchParams('/repo', input, 'compact'); assert.equal(api.ok, true);
    assert.deepEqual(normalizeMcpArgs(buildMcpSearchArgs({ ...input, repoPath: '/repo' })), api.args,
      `transport argv parity ${label}`);
  }
}
for (const input of [{ ext: ['.js', '.ts'] }, { meta: ['team=infra', 'env=prod'] }, { top: 0 },
  { query: '   ' }, { path: [] }, { query: 'needle', cursor: 'cursor' }]) {
  assert.equal(validateMcp(input), validateHttpDomain(input),
    'transport-neutral query/filter presence requirements agree');
}
assert.equal(validateHttp({ ...base, output: 'json' }).ok, true);
assert.equal(validateMcp({ ...base, output: 'json' }), false, 'MCP JSON transport uses compact/full output modes');
assert.equal(validateHttp({ ...base, repo: '/repo' }).ok, true);
assert.equal(validateMcp({ ...base, repo: '/repo' }), false, 'repo is an HTTP-only compatibility alias');
for (const [field, property] of Object.entries(mcpSchema.properties)) {
  if (field === 'output') continue;
  const { description: _description, ...domain } = property;
  assert.deepEqual(domain, httpSchema.properties[field], `shared declared domain ${field}`);
}
const isolated = buildSearchRequestProperties(); isolated.backend.enum.push('foreign');
assert.equal(buildSearchRequestProperties().backend.enum.includes('foreign'), false);

console.log('search request parity test passed');
