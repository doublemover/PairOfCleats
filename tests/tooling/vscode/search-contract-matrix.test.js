#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildSearchArgs,
  readSearchOptions,
  collectSearchHits
} = require('../../../extensions/vscode/search-contract.js');

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
  'search', '--json', '--top', '7', '--mode', 'extracted-prose', '--backend', 'sqlite-fts', '--no-ann',
  '--context', '3', '--file', 'src/index.js', '--path', 'src/', '--lang', 'javascript', '--ext', '.js',
  '--type', 'Function', '--as-of', 'snap:latest', '--filter', 'lang:javascript', '--author', 'Jane Doe',
  '--modified-after', '2025-01-01', '--modified-since', '30', '--churn', '10', '--case', '--explain',
  '--repo', '/repo', '--risk', 'high', '--', 'needle'
]);
assert.deepEqual(buildSearchArgs('alpha', null, {}), ['search', '--json', '--top', '25', '--', 'alpha']);
assert.throws(() => buildSearchArgs('alpha', '/repo', { asOf: 'snap:current', snapshot: 'snap-123' }), /searchAsOf and searchSnapshot/i);

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

const hits = collectSearchHits({
  code: [{ file: 'src/app.js', score: 1 }],
  prose: [{ file: 'README.md', score: 2 }],
  extractedProse: [{ file: 'docs/api.md', score: 3 }],
  records: [{ file: 'records.json', score: 4 }],
  ignored: [{ file: 'skip-me' }]
});
assert.equal(hits.length, 4);
assert.deepEqual(hits.map((hit) => hit.section), ['code', 'prose', 'extracted-prose', 'records']);
assert.equal(hits[2].file, 'docs/api.md');

console.log('vscode search contract matrix test passed');
