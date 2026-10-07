#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildSearchPayload } = require('../../../extensions/vscode/search-contract.js');

const payload = buildSearchPayload('needle', '/repo', {
  mode: 'records',
  backend: 'sqlite',
  annEnabled: false,
  maxResults: 11,
  contextLines: 4,
  file: 'src/index.js',
  path: 'src/',
  lang: 'javascript',
  ext: '.js',
  type: 'Function',
  snapshot: 'snap-123',
  filter: 'lang:javascript',
  author: 'Jane Doe',
  modifiedAfter: '2025-01-01',
  modifiedSince: '30',
  churn: '10',
  caseSensitive: true
});

assert.deepEqual(payload, {
  query: 'needle',
  repo: '/repo',
  top: 11,
  mode: 'records',
  backend: 'sqlite',
  ann: false,
  context: 4,
  file: 'src/index.js',
  path: 'src/',
  lang: 'javascript',
  ext: '.js',
  type: 'Function',
  snapshotId: 'snap-123',
  filter: 'lang:javascript',
  author: 'Jane Doe',
  modifiedAfter: '2025-01-01',
  modifiedSince: '30',
  churnMin: 10,
  case: true
});

const defaultPayload = buildSearchPayload('alpha', '', {});
assert.deepEqual(defaultPayload, {
  query: 'alpha',
  repo: '',
  top: 25,
  mode: 'both'
});

assert.throws(
  () => buildSearchPayload('alpha', '/repo', { asOf: 'snap:current', snapshot: 'snap-123' }),
  /searchAsOf and searchSnapshot/i
);

console.log('vscode search payload mapping test passed');
