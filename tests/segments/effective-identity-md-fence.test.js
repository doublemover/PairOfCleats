#!/usr/bin/env node
import { discoverSegments, chunkSegments } from '../../src/index/segments.js';
import { buildMetaV2 } from '../../src/index/metadata-v2.js';
import { getLanguageForFile } from '../../src/index/language-registry.js';
import { buildLineIndex } from '../../src/shared/lines.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const text = [
  '# Guide',
  '',
  '```tsx',
  'export function greet(name: string) {',
  '  return name;',
  '}',
  '```',
  ''
].join('\n');

const relPath = 'docs/guide.md';
const segments = discoverSegments({
  text,
  ext: '.md',
  relPath,
  mode: 'prose',
  segmentsConfig: { inlineCodeSpans: false }
});
const chunks = chunkSegments({
  text,
  ext: '.md',
  relPath,
  mode: 'prose',
  segments,
  lineIndex: buildLineIndex(text),
  context: {}
});
const target = chunks.find((chunk) => chunk.segment?.languageId === 'tsx');
if (!target) {
  fail('Expected a tsx fenced chunk.');
}

const effectiveLang = getLanguageForFile(target.segment.ext, relPath);
const containerLang = getLanguageForFile('.md', relPath);
const metaV2 = buildMetaV2({
  chunk: {
    ...target,
    file: relPath,
    ext: '.md',
    lang: effectiveLang?.id || null,
    containerLanguageId: containerLang?.id || null
  },
  docmeta: {},
  toolInfo: { tool: 'pairofcleats', version: '0.0.0-test' },
  analysisPolicy: { metadata: { enabled: true } }
});

if (metaV2?.container?.ext !== '.md') {
  fail(`Expected container.ext .md, got ${metaV2?.container?.ext}`);
}
if (metaV2?.effective?.ext !== '.tsx') {
  fail(`Expected effective.ext .tsx, got ${metaV2?.effective?.ext}`);
}
if (metaV2?.lang !== 'typescript') {
  fail(`Expected metaV2.lang typescript, got ${metaV2?.lang}`);
}

console.log('segment effective identity ok');
