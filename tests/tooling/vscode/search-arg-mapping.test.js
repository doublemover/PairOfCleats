#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildSearchArgs } = require('../../../extensions/vscode/search-contract.js');

const args = buildSearchArgs('needle', '/repo', {
  mode: 'extracted-prose',
  backend: 'sqlite-fts',
  annEnabled: false,
  maxResults: 7,
  contextLines: 3,
  file: 'src/index.js',
  path: 'src/',
  lang: 'javascript',
  ext: '.js',
  type: 'Function',
  caseSensitive: true,
  extraArgs: ['--as-of', 'latest']
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
  '--case',
  '--repo',
  '/repo',
  '--as-of',
  'latest',
  '--',
  'needle'
]);

const defaultArgs = buildSearchArgs('alpha', null, {});
assert.deepEqual(defaultArgs, ['search', '--json', '--top', '25', '--', 'alpha']);

console.log('vscode search arg mapping test passed');
