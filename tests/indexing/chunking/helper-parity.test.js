#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import {
  buildChunksFromLineHeadings,
  buildChunksFromMatches
} from '../../../src/index/chunking/helpers.js';

applyTestEnv();

const headingText = [
  'alpha',
  '[one]',
  'value = 1',
  '[two]',
  'value = 2'
].join('\n');
const headingChunks = buildChunksFromLineHeadings(headingText, [
  { line: 1, title: 'one' },
  { line: 3, title: 'two' }
]);
assert.equal(headingChunks.length, 2);
assert.equal(headingChunks[0].name, 'one');
assert.equal(headingChunks[0].kind, 'Section');
assert.equal(headingChunks[0].meta.title, 'one');
assert.equal(headingText.slice(headingChunks[0].start, headingChunks[0].end), '[one]\nvalue = 1\n');
assert.equal(headingChunks[1].name, 'two');
assert.equal(headingText.slice(headingChunks[1].start, headingChunks[1].end), '[two]\nvalue = 2');
assert.equal(buildChunksFromLineHeadings(headingText, []), null);

const markdownText = [
  '# One',
  'hello',
  '## Two',
  'world'
].join('\n');
const markdownMatches = [...markdownText.matchAll(/^#{1,6} .+$/gm)];
const markdownChunks = buildChunksFromMatches(
  markdownText,
  markdownMatches,
  (raw) => raw.replace(/^#+ /, '').trim()
);
assert.equal(markdownChunks.length, 2);
assert.equal(markdownChunks[0].name, 'One');
assert.equal(markdownText.slice(markdownChunks[0].start, markdownChunks[0].end), '# One\nhello\n');
assert.equal(markdownChunks[1].name, 'Two');
assert.equal(markdownText.slice(markdownChunks[1].start, markdownChunks[1].end), '## Two\nworld');
assert.equal(buildChunksFromMatches(markdownText, [], null), null);

console.log('chunking helper parity test passed');
