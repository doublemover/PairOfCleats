#!/usr/bin/env node
import assert from 'node:assert/strict';
import { formatFullChunk } from '../../../src/retrieval/output/format/full.js';
import { color } from '../../../src/retrieval/cli/ansi.js';
import { stripAnsi } from '../../../src/shared/cli/ansi-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const prose = stripAnsi(formatFullChunk({
  chunk: {
    file: 'docs/guides/search.md',
    name: 'Search Pipeline',
    kind: 'Section',
    start: 0,
    end: 1,
    startLine: 1,
    endLine: 4,
    headline: 'Search Pipeline'
  },
  index: 0,
  mode: 'prose',
  color,
  layout: { columns: 88, contentWidth: 84, cacheKey: 'cols:88' },
  _skipCache: true
}));

const extracted = stripAnsi(formatFullChunk({
  chunk: {
    file: 'src/shared/identity.js',
    start: 0,
    end: 1,
    startLine: 31,
    endLine: 35,
    headline: 'chunk ref build record param null memory'
  },
  index: 0,
  mode: 'extracted-prose',
  color,
  layout: { columns: 88, contentWidth: 84, cacheKey: 'cols:88' },
  _skipCache: true
}));

const record = stripAnsi(formatFullChunk({
  chunk: {
    file: 'tests/fixtures/bench-runtime-canaries/gopls-blocked-partitions.log',
    name: 'gopls-blocked-partitions',
    kind: 'Record',
    start: 0,
    end: 1,
    startLine: 1,
    endLine: 3,
    docmeta: {
      doc: 'Language-server startup failed in a blocked partition canary.',
      record: {
        recordType: 'log',
        status: 'open'
      }
    }
  },
  index: 0,
  mode: 'records',
  color,
  layout: { columns: 88, contentWidth: 84, cacheKey: 'cols:88' },
  _skipCache: true
}));

assert.match(prose, /\[section\] Search Pipeline/);
assert.match(extracted, /\[keywords\] chunk ref build record param null memory/);
assert.match(record, /\[type=log\] \[status=open\]/);
assert.match(record, /\[summary\] Language-server startup failed in a blocked partition canary\./);

console.log('prose/comment/record rendering test passed');
