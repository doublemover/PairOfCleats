#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { formatFullChunk } from '../../../src/retrieval/output/format.js';
import { color } from '../../../src/retrieval/cli/ansi.js';

process.env.PAIROFCLEATS_TESTING = '1';

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-summary-'));
const filePath = path.join(rootDir, 'src');
await fs.mkdir(filePath, { recursive: true });
const target = path.join(filePath, 'a.js');
await fs.writeFile(target, 'function alpha() { return 42; }\n');

const chunk = {
  file: 'src/a.js',
  start: 0,
  end: 32,
  startLine: 1,
  endLine: 1,
  name: 'alpha',
  kind: 'Function'
};

const summaryState = { lastCount: 0 };

const withSummary = formatFullChunk({
  chunk,
  index: 0,
  mode: 'code',
  score: 1,
  scoreType: 'bm25',
  explain: false,
  color,
  queryTokens: ['alpha'],
  rx: /alpha/g,
  matched: false,
  rootDir,
  summaryState,
  allowSummary: true
});

const withoutSummary = formatFullChunk({
  chunk,
  index: 0,
  mode: 'code',
  score: 1,
  scoreType: 'bm25',
  explain: false,
  color,
  queryTokens: ['alpha'],
  rx: /alpha/g,
  matched: false,
  rootDir,
  summaryState: { lastCount: 0 },
  allowSummary: false
});

assert.ok(withSummary.includes('Summary'), 'expected summary output when enabled');
assert.ok(!withoutSummary.includes('Summary'), 'expected summary to be skipped');

console.log('context skip summary test passed');
