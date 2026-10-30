import assert from 'node:assert/strict';
import { discoverSegments, chunkSegments, assignSegmentUids } from '../../../src/index/segments.js';
import { readSegmentContent } from '../../../src/shared/embedded-content.js';
import { assignChunkUids } from '../../../src/index/identity/chunk-uid.js';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv();

for (const newline of ['\n', '\r\n']) {
  const text = ['---', 'title: Manual', '---', '# Manual', 'body', '```python', '# Impostor', 'answer = 1', '```', '# End', 'tail'].join(newline);
  const prepare = async (ext, segmentsConfig = {}) => {
    const relPath = 'docs/manual' + ext;
    const segments = discoverSegments({ text, ext, relPath, mode: 'prose', segmentsConfig });
    await assignSegmentUids({ text, ext, mode: 'prose', segments });
    const chunks = chunkSegments({ text, ext, relPath, mode: 'prose', segments,
      context: { treeSitter: { enabled: false }, chunking: { maxBytes: 100000, maxLines: 1000 } } });
    await assignChunkUids({ chunks, fileText: text, fileRelPath: relPath, namespaceKey: 'repo', strict: true });
    return { segments, chunks };
  };
  const md = await prepare('.md'), markdown = await prepare('.markdown');
  const structure = value => ({
    segments: value.segments.map(segment => ({ type: segment.type, languageId: segment.languageId,
      start: segment.start, end: segment.end, content: readSegmentContent(text, segment), meta: segment.meta })),
    chunks: value.chunks.map(chunk => ({ start: chunk.start, end: chunk.end, name: chunk.name,
      kind: chunk.kind, language: chunk.segment?.languageId, type: chunk.segment?.type }))
  });
  assert.deepEqual(structure(markdown), structure(md));
  assert.notDeepEqual(markdown.chunks.map(chunk => chunk.chunkUid), md.chunks.map(chunk => chunk.chunkUid));
  const embedded = markdown.segments.find(segment => segment.type === 'embedded');
  assert.equal(embedded.languageId, 'python');
  assert.equal(readSegmentContent(text, embedded), '# Impostor' + newline + 'answer = 1');
  assert.deepEqual(markdown.chunks.filter(chunk => chunk.segment?.type === 'prose' && !chunk.meta?.preamble).map(chunk => chunk.name), ['Manual', 'End']);
  assert.equal(markdown.segments.find(segment => segment.meta.frontmatter).languageId, 'yaml');
  assert.ok(markdown.segments.filter(segment => segment.type === 'prose').every(segment => segment.languageId === 'markdown'));
  assert.deepEqual(structure(await prepare('.markdown', { cdc: { enabled: true, minFileBytes: 0 } })), structure(markdown));
  assert.equal((await prepare('.markdown', { onlyExtras: true })).segments.length, 0);
  const mdx = await prepare('.mdx');
  assert.equal(mdx.segments.at(-1).languageId, null, 'MDX host qualification is retained');
}
console.log('Markdown extensions share actual segment/content/chunk admission and preserve path-qualified identities.');
