import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { discoverSegments, chunkSegments, assignSegmentUids } from '../../../src/index/segments.js';
import { extractComments, normalizeCommentConfig } from '../../../src/index/comments.js';
import { buildCommentMeta } from '../../../src/index/build/file-processor/cpu/meta.js';
import { assignChunkUids } from '../../../src/index/identity/chunk-uid.js';
import { buildToolingVirtualDocuments, buildVfsManifestRowsForFile } from '../../../src/index/tooling/vfs.js';
import { createChunkTokenBatchInput } from '../../../src/index/build/file-processor/process-chunks/token-input.js';
import { createEmbeddedContentView, readEmbeddedContent, readSegmentContent, readChunkContent,
  mapEmbeddedContentRange, unmapEmbeddedContentRange, embeddedContentIdentity } from '../../../src/shared/embedded-content.js';
import { assertEmbeddedSourceMap } from '../../../src/contracts/validators/embedded-source-map.js';
import { assertRetainedEmbeddedSourceRange } from '../../../src/index/semantic/embedded-map-read.js';
import { semanticHash } from '../../../src/index/semantic/identity.js';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { projectJavaScriptDeclaration } from '../../../src/lang/javascript/declaration-projection.js';
import { buildCodeRelations } from '../../../src/lang/javascript/relations.js';
import { buildLineIndex } from '../../../src/shared/lines.js';
import { validateMetadataV2Semantics } from '../../../src/contracts/validators/metadata.js';
import { buildMetaV2 } from '../../../src/index/metadata-v2.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const json = '{\n  "name": "界😀",\n  "enabled": true\n}';
const jsonCrLf = '{\r\n  "name": "界😀",\r\n  "enabled": true\r\n}';
const rows = value => value.split('\n');
const fixtures = {
  plain: ['```json\n' + json + '\n```', json],
  quote: ['> ```json\n' + rows(json).map(line => '> ' + line).join('\n') + '\n> ```', json],
  list: ['- Example\n\n  ```json\n' + rows(json).map(line => '  ' + line).join('\n') + '\n  ```', json],
  indent: ['  ```json\n' + rows(json).map(line => '  ' + line).join('\n') + '\n  ```', json],
  crlf: ['界😀\r\n> ```json\r\n' + jsonCrLf.split('\r\n').map(line => '> ' + line).join('\r\n') + '\r\n> ```', jsonCrLf],
  blank: ['> ```json\n> {\n> \n>   "name": "界😀",\n>   "enabled": true\n> }\n> ```', '{\n\n  "name": "界😀",\n  "enabled": true\n}'],
  tilde: ['~~~json\n' + json + '\n~~~', json],
  'long-fence': ['````json\n{"name":"```", "enabled":true}\n````', '{"name":"```", "enabled":true}'],
  'starred-json': ['/**\n * Example configuration.\n * ```json\n * {\n *   "name": "界😀",\n *   "enabled": true\n * }\n * ```\n */', json, '.js'],
  'starred-crlf': ['/**\r\n * ```json\r\n * {\r\n *   "name": "界😀",\r\n *   "enabled": true\r\n * }\r\n * ```\r\n */', jsonCrLf, '.js'],
  'unstarred-yaml': ['/*\n    ```yaml\n    root:\n      child: true\n      sibling: false\n    ```\n*/', 'root:\n  child: true\n  sibling: false', '.js'],
  'starred-yaml': ['/**\n * ~~~yaml\n * root:\n *   child: true\n *   sibling: false\n * ~~~\n */', 'root:\n  child: true\n  sibling: false', '.js'],
  toml: ['/**\n * ```toml\n * [application]\n * name = "界😀"\n * enabled = true\n * ```\n */', '[application]\nname = "界😀"\nenabled = true', '.js'],
  html: ['<!--\n  ```json\n  {\n    "name": "界😀",\n    "enabled": true\n  }\n  ```\n-->', json, '.html']
};
const config = normalizeCommentConfig({ extract: 'all', includeInCode: true,
  minDocChars: 0, minInlineChars: 0, minTokens: 0, skipGenerated: false, skipLinter: false });
const prepare = (text, ext = '.md') => {
  const lineIndex = buildLineIndex(text);
  if (ext === '.md') return { segments: discoverSegments({ text, ext, relPath: 'guide.md', mode: 'code' }) };
  const data = extractComments({ text, ext, languageId: ext === '.html' ? 'html' : 'javascript', lineIndex, config });
  const meta = buildCommentMeta({ text, ext, mode: 'extracted-prose', languageId: ext === '.html' ? 'html' : 'javascript',
    lineIndex, normalizedCommentsConfig: config, tokenDictWords: new Set(), dictConfig: {}, commentData: data });
  return { data, meta, segments: discoverSegments({ text, ext, relPath: 'fixture' + ext, mode: 'extracted-prose',
    segmentsConfig: { onlyExtras: true }, extraSegments: meta.extraSegments }) };
};
const jsonChunks = (text, segments, ext = '.md') => chunkSegments({ text, ext, relPath: 'fixture' + ext,
  mode: ext === '.md' ? 'code' : 'extracted-prose', segments,
  context: { treeSitter: { enabled: false } } }).filter(chunk => chunk.segment?.embeddingContext === 'config');
const assertKeys = (text, chunks) => {
  for (const name of ['name', 'enabled']) {
    const chunk = chunks.find(value => value.kind === 'ConfigSection' && value.name === name);
    assert.ok(chunk, `the actual strict JSON chunker must emit ${name}`);
    assert.equal(chunk.start, text.indexOf('"' + name + '"'), `${name} starts at the authored source key`);
    assert.ok(readChunkContent(text, chunk).startsWith('"' + name + '"'));
  }
};

if (fixtures[selected]) {
  const [text, expected, ext = '.md'] = fixtures[selected];
  const result = prepare(text, ext), segment = result.segments.find(value => value.type === 'embedded');
  assert.ok(segment?.contentView);
  assert.equal(readSegmentContent(text, segment), expected, 'independently authored parser input');
  assert.equal(segment.contentView.contentHash, createHash('sha256').update(expected).digest('hex'));
  assert.ok(Object.isFrozen(segment.contentView)); assert.ok(Object.isFrozen(segment.contentView.pieces));
  const chunks = jsonChunks(text, [segment], ext);
  assert.ok(chunks.length, 'logical content reaches the real language chunker');
  if (segment.languageId === 'json') assertKeys(text, chunks);
  if (selected.includes('yaml')) assert.ok(chunks.some(chunk => chunk.name?.includes('child')),
    'nested YAML remains a nested authored config key');
  if (ext !== '.md') {
    assert.equal(result.data.configAdmission.accepted, 1);
    assert.equal(result.data.configAdmission.parsedBytes, Buffer.byteLength(expected));
    assert.equal(result.data.comments[0].start, text.indexOf(ext === '.html' ? '<!--' : '/*'));
    assert.equal(result.data.comments[0].end, text.length, 'broad prose/reference comment extent remains available');
    assert.equal(segment.meta.commentContentIdentity, embeddedContentIdentity(result.data.comments[0].contentView));
    assert.ok(chunks.every(chunk => chunk.segment.contentOrigin.identity === segment.meta.commentContentIdentity));
    for (const chunk of chunks) {
      const metadata = buildMetaV2({ chunk: { ...chunk, file: 'fixture' + ext, ext } });
      assert.deepEqual(metadata.segment.contentView, segment.contentView);
      assert.equal(metadata.segment.contentOrigin.identity, segment.meta.commentContentIdentity);
      assert.deepEqual(validateMetadataV2Semantics(metadata), []);
    }
    assert.ok(result.meta.extraSegments.some(value => value.type === 'comment'));
  }
} else if (selected === 'vfs-and-token-input') {
  const [text, expected, ext] = fixtures['starred-json'];
  const { segments } = prepare(text, ext);
  const segment = segments.find(value => value.type === 'embedded');
  await assignSegmentUids({ text, ext, mode: 'extracted-prose', segments: [segment] });
  const chunks = jsonChunks(text, [segment], ext).map(chunk => ({ ...chunk, file: 'fixture.js', ext, lang: 'json' }));
  await assignChunkUids({ chunks, fileText: text, fileRelPath: 'fixture.js', strict: true });
  const { documents, targets } = await buildToolingVirtualDocuments({ chunks, fileTextByPath: new Map([['fixture.js', text]]),
    strict: true, coalesceSegments: true });
  assert.equal(documents.length, 1); assert.equal(documents[0].text, expected);
  assert.deepEqual(documents[0].contentView, segment.contentView);
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index], target = targets.find(value => value.chunkRef.chunkUid === chunk.chunkUid);
    assert.equal(expected.slice(target.virtualRange.start, target.virtualRange.end), readChunkContent(text, chunk));
  }
  const manifest = await buildVfsManifestRowsForFile({ chunks, fileText: text, containerPath: 'fixture.js', containerExt: ext });
  assert.equal(manifest[0].docHash, documents[0].docHash);
  assert.deepEqual(manifest[0].extensions.embeddedContent, segment.contentView);
  const input = createChunkTokenBatchInput({ chunksForProcessing: chunks, text, tokenMode: 'prose', containerExt: ext,
    relKey: 'fixture.js', containerLanguageId: 'javascript', normalizedCommentsConfig: { includeInCode: false },
    commentRangeAssignments: new Map(chunks.map((_, index) => [index, [{ start: 0, end: text.length }]])),
    chunkLineRanges: [], tokenizationFileStreamEnabled: false, fileStat: { size: Buffer.byteLength(text) } })(0);
  assert.equal(input.text, readChunkContent(text, chunks[0]), 'container comment stripping cannot erase the admitted config view');
} else if (selected === 'mapping-and-identity') {
  const [text, expected] = fixtures.quote;
  const segment = prepare(text).segments.find(value => value.type === 'embedded'), view = segment.contentView;
  const local = { start: expected.indexOf('"name"'), end: expected.indexOf('true') + 4 };
  const pieces = mapEmbeddedContentRange(view, local.start, local.end);
  assert.ok(pieces.length > 1);
  assert.equal(pieces.map(piece => text.slice(piece.start, piece.end)).join(''), expected.slice(local.start, local.end));
  assert.deepEqual(unmapEmbeddedContentRange(view, pieces[0].start, pieces.at(-1).end), local);
  assert.throws(() => unmapEmbeddedContentRange(view, text.indexOf('> ', text.indexOf('"name"')), view.sourceEnd),
    { code: 'ERR_EMBEDDED_CONTENT' }, 'a stripped quote marker is not a source coordinate');
  const plain = prepare(fixtures.plain[0]).segments.find(value => value.type === 'embedded');
  await assignSegmentUids({ text, ext: '.md', mode: 'code', segments: [segment] });
  await assignSegmentUids({ text: fixtures.plain[0], ext: '.md', mode: 'code', segments: [plain] });
  assert.notEqual(plain.segmentUid, segment.segmentUid, 'equal content cannot reuse an incompatible map');
  assert.notEqual(embeddedContentIdentity(plain.contentView), embeddedContentIdentity(view));
} else if (selected === 'invalid-views') {
  const [text] = fixtures.quote, view = prepare(text).segments.find(value => value.type === 'embedded').contentView;
  for (const mutate of [value => value.schemaVersion++, value => value.policy = 'markdown-fenced-content-v2',
    value => value.pieces[1].localStart++, value => value.contentHash = '0'.repeat(64), value => value.length++]) {
    const changed = structuredClone(view); mutate(changed);
    assert.throws(() => readEmbeddedContent(text, changed), { code: 'ERR_EMBEDDED_CONTENT' });
  }
  assert.throws(() => readEmbeddedContent(text.replace('界', '外'), view), { code: 'ERR_EMBEDDED_CONTENT' });
  assert.throws(() => createEmbeddedContentView('😀', [{ start: 1, end: 2 }], {
    containerStart: 0, containerEnd: 2, policy: 'markdown-fenced-content-v1' }), { code: 'ERR_EMBEDDED_CONTENT' });
} else if (selected === 'semantic-map') {
  const [text, localText] = fixtures.quote, view = prepare(text).segments.find(value => value.type === 'embedded').contentView;
  const parent = createSemanticSourceSnapshot({ bytes: Buffer.from(text), repositoryNamespace: 'fixture', path: 'guide.md', language: 'markdown' });
  const map = assertEmbeddedSourceMap({ schemaVersion: 2, kind: 'embedded-piecewise-range', quality: 'exact',
    parentSourceUnitId: parent.manifest.sourceUnitId, parentByteHash: parent.manifest.byteHash,
    parentStart: view.sourceStart, parentEnd: view.sourceEnd, localStart: 0, localEnd: localText.length,
    coordinateUnit: 'utf16', segmentUid: 'fixture-segment', language: 'javascript', contentView: view });
  const local = createSemanticSourceSnapshot({ bytes: Buffer.from(localText), repositoryNamespace: 'fixture', path: 'embedded.js', language: 'javascript',
    mapping: { identity: semanticHash('semantic.embedded-map.v1', map), parentSourceUnitId: parent.manifest.sourceUnitId,
      quality: 'exact', mapRef: 'semantic-evidence/' + '1'.repeat(64) + '.json' } });
  assert.equal(assertRetainedEmbeddedSourceRange({ map, source: local.manifest, localText, parentSource: parent.manifest, parentText: text }), map);
  const gap = structuredClone(map); gap.contentView.pieces[1].localStart++;
  assert.throws(() => assertEmbeddedSourceMap(gap), { code: 'ERR_EMBEDDED_SOURCE_MAP_CONTRACT' });
  assert.throws(() => assertEmbeddedSourceMap({ ...map, schemaVersion: 1 }), { code: 'ERR_EMBEDDED_SOURCE_MAP_CONTRACT' });
  assert.throws(() => assertRetainedEmbeddedSourceRange({ map, source: local.manifest,
    localText: localText.replace('界', '外'), parentSource: parent.manifest, parentText: text }), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
} else if (selected === 'javascript-projection') {
  const text = '> ```js\n> function first() { return 1; }\n> function second(value = 2) { return value; }\n> ```';
  const segment = prepare(text).segments.find(value => value.type === 'embedded');
  const content = readSegmentContent(text, segment);
  const chunks = chunkSegments({ text, ext: '.md', relPath: 'guide.md', mode: 'code', segments: [segment], context: { treeSitter: { enabled: false } } });
  const chunk = chunks.find(value => value.name === 'second'); assert.ok(chunk);
  assert.equal(chunk.start, text.indexOf('function second'));
  const localChunk = { ...chunk, ...unmapEmbeddedContentRange(segment.contentView, chunk.start, chunk.end) };
  const relations = buildCodeRelations(content, 'guide.md#second');
  const projection = projectJavaScriptDeclaration(content, localChunk, relations, {}, { text, chunk, contentView: segment.contentView });
  assert.equal(projection.javascriptDeclaration.sourceMapping.schemaVersion, 2);
  assert.equal(projection.javascriptDeclaration.projectionRange.start, chunk.start);
  const metadata = { javascriptDeclaration: projection.javascriptDeclaration, segment: chunk.segment,
    range: { start: chunk.start, end: chunk.end } };
  assert.deepEqual(validateMetadataV2Semantics(metadata), []);
  const wrong = structuredClone(metadata); wrong.segment.contentView.policy = 'unknown-policy-v2';
  assert.ok(validateMetadataV2Semantics(wrong).length, 'metadata cannot attach a different or unknown piecewise map');
  const retained = buildMetaV2({ chunk: { ...chunk, file: 'guide.md', ext: '.md', lang: 'javascript' },
    docmeta: { ...projection.metadata, flowEvidence: projection.flowEvidence, javascriptDeclaration: projection.javascriptDeclaration } });
  assert.deepEqual(retained.segment.contentView, segment.contentView, 'actual metadata projection cannot drop the map before persistence');
  assert.deepEqual(validateMetadataV2Semantics(retained), []);
} else if (selected === 'closing-and-invalid-config') {
  for (const source of ['/**\n * ```json\n * { nope }\n * ```\n */',
    '/**\n * ````json\n * {}\n * ```\n */', '/**\n * ```json\n * {}\n */']) {
    const { data } = prepare(source, '.js');
    assert.equal(data.configSegments.length, 0, 'invalid or unclosed comment fences cannot become positive config products');
    assert.ok(data.configAdmission.invalid > 0 || data.configAdmission.exclusions.some(value => value.reason === 'unclosed-comment-fence'));
  }
} else if (selected === 'piece-budget') {
  const text = '> ```json\n' + Array.from({ length: 270 }, () => '> "x",').join('\n') + '\n> ```';
  const segment = prepare(text).segments.find(value => value.type === 'embedded');
  assert.equal(segment.contentUnavailable, 'piece-budget'); assert.equal(segment.contentView, null);
  assert.deepEqual(jsonChunks(text, [segment]), [], 'no raw host-text fallback masquerades as an exact parser view');
} else throw new Error(`Unknown embedded content case ${selected}`);
console.log(`embedded content ${selected} passed`);
