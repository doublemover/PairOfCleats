#!/usr/bin/env node
import { discoverSegments, chunkSegments } from '../../src/index/segments.js';
import { buildLineIndex } from '../../src/shared/lines.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const text = [
  '# Guide',
  '',
  '```tsx',
  'export const Button = () => <div />;',
  '```',
  '',
  '```jsx',
  'export const Badge = () => <span />;',
  '```',
  ''
].join('\n');

const segments = discoverSegments({
  text,
  ext: '.md',
  relPath: 'docs/guide.md',
  mode: 'prose',
  segmentsConfig: { inlineCodeSpans: false }
});
const chunks = chunkSegments({
  text,
  ext: '.md',
  relPath: 'docs/guide.md',
  mode: 'prose',
  segments,
  lineIndex: buildLineIndex(text),
  context: {}
});

const languageIds = new Set(chunks.map((chunk) => chunk.segment?.languageId).filter(Boolean));
if (!languageIds.has('tsx')) {
  fail('Expected tsx fence hint to be preserved on chunk.segment.languageId.');
}
if (!languageIds.has('jsx')) {
  fail('Expected jsx fence hint to be preserved on chunk.segment.languageId.');
}

console.log('segment tsx/jsx hint preservation ok');
