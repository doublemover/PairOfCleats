#!/usr/bin/env node
import assert from 'node:assert/strict';
import { formatFullChunk } from '../../../src/retrieval/output/format.js';

const color = new Proxy({}, {
  get: () => (value) => String(value)
});

const malformedChunk = {
  file: 'src/app.js',
  startLine: 10,
  endLine: 20,
  start: 120,
  end: 340,
  kind: 'FunctionDeclaration',
  name: 'run',
  last_modified: null,
  docmeta: {
    signature: 'run() => void',
    returnsValue: true,
    throws: 'throw',
    decorators: '@trace',
    awaits: 'await',
    dataflow: {
      reads: 'state',
      writes: { length: 1 },
      mutations: 'model',
      aliases: 'alias',
      globals: 'window',
      nonlocals: 'context'
    },
    risk: {
      severity: 'high',
      tags: 'taint',
      flows: 'source->sink'
    }
  },
  codeRelations: {
    imports: 'lodash',
    exports: 'run',
    calls: 'helper',
    callSummaries: 'run()',
    importLinks: 'src/helper.js',
    usages: 'helper'
  },
  usages: 'helper',
  lint: 'unexpected',
  externalDocs: 'https://example.com'
};

const rendered = formatFullChunk({
  chunk: malformedChunk,
  index: 0,
  mode: 'code',
  score: 1,
  scoreType: 'bm25',
  explain: true,
  color,
  queryTokens: [],
  matched: false,
  rootDir: process.cwd(),
  summaryState: null,
  allowSummary: false,
  _skipCache: true
});

assert.equal(typeof rendered, 'string', 'expected rendered output string');
assert.ok(rendered.includes('src/app.js'), 'expected file path in output');
assert.ok(rendered.includes('run'), 'expected symbol name in output');

console.log('format malformed docmeta lists test passed');
