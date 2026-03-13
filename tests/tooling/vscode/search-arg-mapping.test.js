#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildSearchArgs } = require('../../../extensions/vscode/search-contract.js');

const args = buildSearchArgs('needle', '/repo', {
  mode: 'extracted-prose',
  backend: 'sqlite-fts',
  annEnabled: false,
  explain: true,
  maxResults: 7,
  contextLines: 3,
  file: 'src/index.js',
  path: 'src/',
  lang: 'javascript',
  ext: '.js',
  type: 'Function',
  asOf: 'snap:latest',
  filter: 'lang:javascript',
  author: 'Jane Doe',
  modifiedAfter: '2025-01-01',
  modifiedSince: '30',
  churn: '10',
  caseSensitive: true,
  extraArgs: ['--risk', 'high']
});

assert.deepEqual(args, [
  'search',
  '--json',
  '--top',
  '7',
  '--mode',
  'extracted-prose',
  '--backend',
  'sqlite-fts',
  '--no-ann',
  '--context',
  '3',
  '--file',
  'src/index.js',
  '--path',
  'src/',
  '--lang',
  'javascript',
  '--ext',
  '.js',
  '--type',
  'Function',
  '--as-of',
  'snap:latest',
  '--filter',
  'lang:javascript',
  '--author',
  'Jane Doe',
  '--modified-after',
  '2025-01-01',
  '--modified-since',
  '30',
  '--churn',
  '10',
  '--case',
  '--explain',
  '--repo',
  '/repo',
  '--risk',
  'high',
  '--',
  'needle'
]);

const defaultArgs = buildSearchArgs('alpha', null, {});
assert.deepEqual(defaultArgs, ['search', '--json', '--top', '25', '--', 'alpha']);

assert.throws(
  () => buildSearchArgs('alpha', '/repo', { asOf: 'snap:current', snapshot: 'snap-123' }),
  /searchAsOf and searchSnapshot/i
);

console.log('vscode search arg mapping test passed');
