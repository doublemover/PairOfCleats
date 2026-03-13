#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { readSearchOptions } = require('../../../extensions/vscode/search-contract.js');

const settings = {
  modeKey: 'searchMode',
  backendKey: 'searchBackend',
  annKey: 'searchAnn',
  maxResultsKey: 'maxResults',
  contextLinesKey: 'searchContextLines',
  fileKey: 'searchFile',
  pathKey: 'searchPath',
  langKey: 'searchLang',
  extKey: 'searchExt',
  typeKey: 'searchType',
  asOfKey: 'searchAsOf',
  snapshotKey: 'searchSnapshot',
  filterKey: 'searchFilter',
  authorKey: 'searchAuthor',
  modifiedAfterKey: 'searchModifiedAfter',
  modifiedSinceKey: 'searchModifiedSince',
  churnKey: 'searchChurn',
  caseSensitiveKey: 'searchCaseSensitive',
  extraSearchArgsKey: 'extraSearchArgs'
};

const options = readSearchOptions({
  get(key) {
    return {
      searchMode: 'code',
      searchBackend: 'sqlite',
      searchAnn: false,
      maxResults: 50,
      searchContextLines: 2,
      searchFile: 'src/app.ts',
      searchPath: 'src/',
      searchLang: 'typescript',
      searchExt: '.ts',
      searchType: 'Function',
      searchAsOf: 'snap:current',
      searchSnapshot: '',
      searchFilter: 'lang:typescript',
      searchAuthor: 'Jane Doe',
      searchModifiedAfter: '2025-01-01',
      searchModifiedSince: '14',
      searchChurn: '25',
      searchCaseSensitive: true,
      extraSearchArgs: ['--risk', 'high']
    }[key];
  }
}, settings);

assert.deepEqual(options, {
  mode: 'code',
  backend: 'sqlite',
  annEnabled: false,
  maxResults: 50,
  contextLines: 2,
  file: 'src/app.ts',
  path: 'src/',
  lang: 'typescript',
  ext: '.ts',
  type: 'Function',
  asOf: 'snap:current',
  snapshot: '',
  filter: 'lang:typescript',
  author: 'Jane Doe',
  modifiedAfter: '2025-01-01',
  modifiedSince: '14',
  churn: '25',
  caseSensitive: true,
  extraArgs: ['--risk', 'high']
});

console.log('vscode search contract options test passed');
