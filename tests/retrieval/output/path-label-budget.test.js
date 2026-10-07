#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  truncatePathMiddle,
  truncateVisibleText
} from '../../../src/retrieval/output/format/display-meta.js';
import { formatShortChunk } from '../../../src/retrieval/output/format/short.js';
import { formatFullChunk } from '../../../src/retrieval/output/format/full.js';
import { compactHit } from '../../../src/retrieval/cli/render-output.js';
import { buildFileHyperlink } from '../../../src/retrieval/output/format/ansi.js';
import { stripAnsi } from '../../../src/shared/cli/ansi-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
globalThis.fetch = () => { throw new Error('Path-label fixtures cannot fetch'); };

const color = Object.fromEntries(['red', 'bold', 'yellow', 'green', 'gray', 'cyan'].map((key) => [key, String]));
const file = `packages/parser/generated/${'long-component-'.repeat(8)}configuration-loader.test.js`;
const shortened = truncatePathMiddle(file, 32);
assert.ok(shortened.length <= 32, 'long basenames must obey the existing UTF-16 label budget');
assert.match(shortened, /^\.\.\.\//u);
assert.match(shortened, /\.test\.js$/u, 'keep the identifying filename tail when space permits');
assert.match(shortened.slice(4), /\.\.\./u, 'make basename truncation visible');

assert.equal(truncatePathMiddle('src/module/file.js', 64), 'src/module/file.js');
assert.equal(truncatePathMiddle('src/services/small/file.js', 18), '.../small/file.js');
assert.match(truncatePathMiddle(`C:\\project\\${'component-'.repeat(10)}main.test.js`, 32), /\.test\.js$/u);
assert.match(truncatePathMiddle(`${'component-'.repeat(10)}main.test.js`, 24), /\.test\.js$/u);

// These budgets count UTF-16 units. Wide CJK glyphs may occupy more terminal
// cells; this fixture does not claim wcwidth or whole-line column fidelity.
const family = '👩‍💻';
const samples = [
  'aa😀tail', `aa${family}tail`, 'e\u0301'.repeat(12), '資料'.repeat(18),
  `src/${'😀'.repeat(14)}.test.js`, `src/${family.repeat(10)}.js`,
  `src/${'e\u0301'.repeat(20)}.js`, `src/${'資料'.repeat(14)}.js`,
  `src/${'long-'.repeat(20)}name.${'extension'.repeat(8)}`
];
for (const value of samples) {
  for (const budget of [0, 1, 2, 3, 6, 12, 18, 24, 32, 72]) {
    for (const label of [truncateVisibleText(value, budget), truncatePathMiddle(value, budget)]) {
      assert.ok(label.length <= budget, `UTF-16 budget exceeded for ${JSON.stringify(value)}`);
      assert.ok(label.isWellFormed(), 'truncation must preserve complete Unicode code points');
      assert.ok(!label.startsWith('\u0301'), 'a combining sequence must not begin with its detached mark');
      assert.ok(!label.endsWith('\u200d'), 'do not leave a detached joiner');
      if (label.includes('\u200d')) {
        assert.equal(label.replaceAll(family, '').includes('\u200d'), false,
          'retained ZWJ sequences must remain complete graphemes');
      }
    }
  }
}
assert.equal(truncateVisibleText('aa😀tail', 6), 'aa...');
assert.equal(truncateVisibleText('e\u0301'.repeat(8), 6), 'e\u0301...');
assert.equal(truncateVisibleText('abcdef', 1, { ellipsis: '😀' }), '');
assert.equal(truncateVisibleText('abcdef', 2, { ellipsis: '😀' }), '😀');
for (const budget of [0, 1, 2, 3, 6, 12, 18, 24, 32]) {
  for (const ellipsis of ['😀/', `${family}/`, 'e\u0301/']) {
    const label = truncatePathMiddle(file, budget, { ellipsis });
    assert.ok(label.length <= budget, 'the small-budget preguard must also bound custom markers');
    assert.ok(label.isWellFormed(), 'custom markers must not introduce a partial code point');
    if (label.includes('\u200d')) {
      assert.equal(label.replaceAll(family, '').includes('\u200d'), false);
    }
  }
}

const chunk = { id: 7, file, name: 'loadConfiguration', kind: 'Function', start: 20, end: 120,
  startLine: 100, endLine: 120 };
const original = structuredClone(chunk);
const options = { chunk, index: 0, mode: 'code', color, score: 1, scoreType: 'rrf',
  rootDir: '/fixture/repository', hyperlinkMode: 'off',
  layout: { columns: 72, contentWidth: 68, isNarrow: true, cacheKey: 'cols:72' }, _skipCache: true };
assert.equal(stripAnsi(formatShortChunk(options)), [
  '1. loadConfiguration',
  '  .../long-component-long-compon...onfiguration-loader.test.js:[100-120]',
  '  Function loadConfiguration',
  ''
].join('\n'), 'keep the reviewed ASCII short-result golden stable');
for (const formatter of [formatShortChunk, formatFullChunk]) {
  const output = stripAnsi(formatter(options));
  const pathLine = output.split('\n').find((line) => line.includes(':[100-120]'));
  assert.ok(pathLine.length <= 72, 'the ASCII fixture path line must fit its assigned budget');
  assert.match(pathLine, /\.test\.js:\[100-120\]/u);
  assert.deepEqual(chunk, original, 'display shortening must not mutate source identity');
  const linked = formatter({ ...options, hyperlinkMode: 'file' });
  const target = buildFileHyperlink({ filePath: file, line: 100, rootDir: options.rootDir, mode: 'file' });
  assert.ok(linked.includes(`\x1b]8;;${target}\x1b\\`), 'OSC8 targets retain the full path');
}
assert.equal(compactHit(chunk).file, file, 'machine projections retain the full file path');
assert.deepEqual([compactHit(chunk).start, compactHit(chunk).end], [20, 120]);

console.log('path label UTF-16 budget and grapheme-boundary tests passed');
