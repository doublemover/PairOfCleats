import assert from 'node:assert/strict';
import { detectFrontmatter } from '../../../src/index/segments/frontmatter.js';
import { discoverSegments, chunkSegments, assignSegmentUids } from '../../../src/index/segments.js';
import { assignChunkUids, computeSegmentUid } from '../../../src/index/identity/chunk-uid.js';
import { buildToolingVirtualDocuments } from '../../../src/index/tooling/vfs.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/segments/frontmatter-content-ownership/')[1];
const cases = ['json-lf', 'json-crlf', 'toml-lf', 'toml-crlf', 'yaml-policy', 'empty', 'missing-close', 'uid-policy'];
assert.ok(cases.includes(mode), `Unknown case ${mode}`);
const eol = mode.endsWith('crlf') ? '\r\n' : '\n';
const language = mode.startsWith('toml') ? 'toml' : mode === 'yaml-policy' ? 'yaml' : 'json';
const delimiter = { json: ';;;', toml: '+++', yaml: '---' }[language];
const content = language === 'json' ? '{"name":"界😀","enabled":true}' + eol
  : language === 'toml' ? '[application]' + eol + 'name = "界😀"' + eol + 'enabled = true' + eol
    : 'name: "界😀"' + eol + 'enabled: true' + eol;
const body = mode === 'empty' ? '' : content;
const text = delimiter + eol + body + (mode === 'missing-close' ? '' : delimiter + eol) + '# Host prose\n';
const frontmatter = detectFrontmatter(text);
if (mode === 'missing-close') assert.equal(frontmatter, null);
else {
  assert.equal(frontmatter.start, 0); assert.equal(frontmatter.end, delimiter.length + eol.length + body.length + delimiter.length + (eol === '\r\n' ? 1 : 0));
  assert.equal(frontmatter.contentStart, delimiter.length + eol.length);
  assert.equal(frontmatter.contentEnd, delimiter.length + eol.length + body.length);
  assert.equal(text.slice(frontmatter.contentStart, frontmatter.contentEnd), body, 'actual original interior, never normalized legacy raw');
}
const segments = discoverSegments({ text, ext: '.md', relPath: 'guide.md', mode: 'code', segmentsConfig: { frontmatterProse: true } });
const configSegments = segments.filter(segment => segment.type === 'config' && segment.meta?.frontmatter);
if (['empty', 'missing-close'].includes(mode)) assert.deepEqual(configSegments, []);
else {
  assert.equal(configSegments.length, 1);
  const segment = configSegments[0];
  assert.equal(text.slice(segment.start, segment.end), content);
  assert.equal(segment.meta.containerStart, frontmatter.start); assert.equal(segment.meta.containerEnd, frontmatter.end);
  const prose = segments.find(segment => segment.type === 'prose' && segment.meta?.frontmatter);
  assert.equal(prose.start, frontmatter.start); assert.equal(prose.end, frontmatter.end, 'prose container policy remains independent');
  const context = { treeSitter: { enabled: false } };
  const chunks = chunkSegments({ text, ext: '.md', relPath: 'guide.md', mode: 'code', segments, context });
  const configChunks = chunks.filter(chunk => chunk.segment?.type === 'config');
  assert.ok(configChunks.length > 0);
  assert.ok(configChunks.every(chunk => chunk.start >= segment.start && chunk.end <= segment.end));
  assert.ok(configChunks.every(chunk => !text.slice(chunk.start, chunk.end).includes(delimiter)));
  if (language === 'json') {
    for (const name of ['name', 'enabled']) {
      const chunk = configChunks.find(chunk => chunk.kind === 'ConfigSection' && chunk.name === name);
      assert.ok(chunk, `${name} must be parsed from delimiter-free JSON`);
      assert.equal(chunk.start, text.indexOf(`"${name}"`));
    }
  } else if (language === 'toml') assert.ok(configChunks.some(chunk => chunk.name === 'application' && chunk.meta?.parserFallbackReason === null));
  const proseChunks = chunkSegments({ text, ext: '.md', relPath: 'guide.md', mode: 'prose', segments, context });
  assert.equal(proseChunks.some(chunk => chunk.segment?.type === 'config'), false, 'non-embedded config remains outside default prose admission');
  await assignSegmentUids({ text, ext: '.md', mode: 'code', segments });
  const ownedChunks = chunkSegments({ text, ext: '.md', relPath: 'guide.md', mode: 'code', segments: [segment], context })
    .map(chunk => ({ ...chunk, file: 'guide.md', ext: '.md', lang: language }));
  await assignChunkUids({ chunks: ownedChunks, fileText: text, fileRelPath: 'guide.md', strict: true });
  const { documents, targets } = await buildToolingVirtualDocuments({ chunks: ownedChunks,
    fileTextByPath: new Map([['guide.md', text]]), strict: true });
  assert.equal(documents.length, 1); assert.equal(documents[0].text, content);
  assert.ok(targets.length > 0);
  for (const target of targets) {
    const original = ownedChunks.find(chunk => chunk.chunkUid === target.chunkRef.chunkUid);
    assert.equal(documents[0].text.slice(target.virtualRange.start, target.virtualRange.end), text.slice(original.start, original.end));
  }
  if (mode === 'uid-policy') {
    const input = { segmentText: content, segmentType: 'config', languageId: language };
    const legacy = await computeSegmentUid(input), changed = await computeSegmentUid({ ...input, extractionPolicy: 'markdown-frontmatter-content-v2' });
    assert.notEqual(segment.segmentUid, legacy); assert.notEqual(segment.segmentUid, changed);
    assert.equal(segment.segmentUid, await computeSegmentUid({ ...input, extractionPolicy: segment.meta.extractionPolicy }));
  }
}
console.log(`Frontmatter content ownership: ${mode}`);
