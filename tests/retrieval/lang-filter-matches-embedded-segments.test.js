#!/usr/bin/env node
import { discoverSegments, chunkSegments, assignSegmentUids } from '../../src/index/segments.js';
import { buildMetaV2 } from '../../src/index/metadata-v2.js';
import { getLanguageForFile } from '../../src/index/language-registry.js';
import { buildLineIndex } from '../../src/shared/lines.js';
import { buildFilterIndex } from '../../src/retrieval/filter-index.js';
import { filterChunks } from '../../src/retrieval/output.js';

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
const ext = '.md';
const segments = discoverSegments({
  text,
  ext,
  relPath,
  mode: 'prose',
  segmentsConfig: { inlineCodeSpans: false }
});
await assignSegmentUids({ text, segments, ext, mode: 'prose' });
const chunks = chunkSegments({
  text,
  ext,
  relPath,
  mode: 'prose',
  segments,
  lineIndex: buildLineIndex(text),
  context: {}
});

const containerLang = getLanguageForFile(ext, relPath);
const chunkMeta = chunks.map((chunk, id) => {
  const effectiveExt = chunk.segment?.ext || ext;
  const effectiveLang = getLanguageForFile(effectiveExt, relPath);
  const containerLanguageId = containerLang?.id || null;
  const lang = effectiveLang?.id || chunk.segment?.languageId || containerLanguageId || 'unknown';
  const metaV2 = buildMetaV2({
    chunk: {
      ...chunk,
      file: relPath,
      ext,
      lang,
      containerLanguageId,
      effectiveExt
    },
    docmeta: {},
    toolInfo: { tool: 'pairofcleats', version: '0.0.0-test' },
    analysisPolicy: { metadata: { enabled: true } }
  });
  return {
    id,
    file: relPath,
    ext,
    kind: chunk.kind || null,
    name: chunk.name || null,
    metaV2
  };
});

const filterIndex = buildFilterIndex(chunkMeta);
const hits = filterChunks(chunkMeta, { lang: 'typescript' }, filterIndex);
if (!hits.length) fail('Expected lang filter to return embedded TypeScript chunks.');
if (!hits.every((hit) => hit.metaV2?.lang === 'typescript')) {
  fail('Expected all lang-filtered hits to have metaV2.lang=typescript.');
}

console.log('lang filter matches embedded segments');
