#!/usr/bin/env node
import assert from 'node:assert/strict';
import { formatShortChunk } from '../../../src/retrieval/output/format.js';
import { color } from '../../../src/retrieval/cli/ansi.js';
import { stripAnsi } from '../../../src/shared/cli/ansi-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const chunk = {
  file: 'src/retrieval/cli/render.js',
  name: 'renderSearchOutput',
  kind: 'Function',
  start: 0,
  end: 1,
  startLine: 20,
  endLine: 60,
  last_modified: '2026-03-28T11:00:00.000Z',
  headline: 'renderSearchOutput emits JSON and human-facing search output.',
  docmeta: {
    signature: 'renderSearchOutput(options)'
  }
};

const narrow = formatShortChunk({
  chunk,
  index: 1,
  mode: 'code',
  score: 0.9,
  scoreType: 'rrf',
  explain: false,
  color,
  queryTokens: ['renderSearchOutput'],
  rx: /renderSearchOutput/g,
  matched: false,
  layout: { columns: 72, isNarrow: true, cacheKey: 'cols:72' },
  _skipCache: true
});

const wide = formatShortChunk({
  chunk,
  index: 1,
  mode: 'code',
  score: 0.9,
  scoreType: 'rrf',
  explain: false,
  color,
  queryTokens: ['renderSearchOutput'],
  rx: /renderSearchOutput/g,
  matched: false,
  hyperlinkMode: 'file',
  rootDir: 'C:\\Users\\sneak\\Development\\DOUBLECLEAT',
  layout: { columns: 188, isNarrow: false, cacheKey: 'cols:188' },
  _skipCache: true
});

assert.notEqual(narrow, wide, 'expected width-specific rendering to differ');
assert.match(narrow, /\n  .*src\/retrieval\/cli\/render\.js/u);
assert.match(stripAnsi(wide), /\n  .*src\/retrieval\/cli\/render\.js.*(?:just now|ago|AM|PM)/u);
assert.match(stripAnsi(wide), /\n  .*renderSearchOutput\(options\)/u);
assert.doesNotMatch(stripAnsi(narrow), /src\/retrieval\/cli\/render\.js.* • .*?(?:just now|ago|AM|PM)/u);
assert.doesNotMatch(stripAnsi(wide), /\n\s*\n/u, 'expected compact formatter output to avoid blank spacer lines');

console.log('responsive short-format layout test passed');
