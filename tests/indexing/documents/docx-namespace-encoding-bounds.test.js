import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { extractDocx, loadDocxExtractorRuntime, parseDocxParagraphsFromXml } from '../../../src/index/extractors/docx.js';
import { decodeDocxXmlBytes } from '../../../src/index/extractors/docx-xml-bytes.js';
import { buildDocxExtractionText } from '../../../src/index/build/file-processor/extraction.js';
import { chunkDocxDocument } from '../../../src/index/chunking/formats/docx.js';
import { buildMinimalDocxBuffer } from '../../helpers/document-fixtures.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveExtractionNormalizationPolicy } from '../../../src/index/extractors/common.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

applyTestEnv();
const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const strictWord = 'http://purl.oclc.org/ooxml/wordprocessingml/main';
const document = (prefix, uri = word) => {
  const p = prefix ? prefix + ':' : '';
  return `<?xml version="1.0" encoding="UTF-8"?><${p}document ${prefix ? 'xmlns:' + prefix : 'xmlns'}="${uri}" xmlns:a="${uri}" xmlns:other="urn:foreign">
    <${p}body><${p}p/><!-- <${p}p><${p}r><${p}t>fake comment content</${p}t></${p}r></${p}p> -->
    <${p}p><${p}pPr><${p}pStyle a:val="Heading1"/></${p}pPr><${p}r><${p}t>Heading 😀</${p}t></${p}r></${p}p>
    <${p}tbl><${p}tr><${p}tc><${p}p><${p}r><${p}t>A</${p}t><${p}tab/><${p}t>B</${p}t><${p}br/><${p}t>C</${p}t><${p}cr/><${p}t>É &amp; D</${p}t></${p}r></${p}p></${p}tc></${p}tr></${p}tbl>
    <${p}moveFrom a:id="4"><${p}p><${p}r><${p}t>deleted source</${p}t></${p}r></${p}p></${p}moveFrom>
    <other:group xmlns:w="urn:foreign"><w:p><w:t>spoof</w:t></w:p><a:p><a:r><a:t>Tail</a:t></a:r></a:p></other:group>
    </${p}body></${p}document>`;
};
const expected = [{ index: 2, style: 'Heading1', text: 'Heading 😀' }, { index: 3, text: 'A B\nC\nÉ & D' }, { index: 5, text: 'Tail' }];
const chunked = paragraphs => {
  const extracted = buildDocxExtractionText(paragraphs);
  const chunks = chunkDocxDocument(extracted.text, { documentExtraction: extracted,
    documentChunking: { maxCharsPerChunk: 1024, maxUnitsPerChunk: 2 } });
  return { extracted, chunks };
};
const baseline = chunked(expected);
assert.deepEqual(baseline.extracted.units.map(unit => unit.index), [2, 3, 5]);
assert.equal(baseline.chunks[0].segment.paragraphStart, 2);
assert.equal(baseline.chunks.at(-1).segment.paragraphEnd, 5);
assert.equal(resolveExtractionNormalizationPolicy('docx'), 'v1:docx-xml:3');
assert.equal(resolveExtractionNormalizationPolicy('pdf'), 'v1:pdf-text:2');
for (const xml of [document('w'), document('m'), document(''), document('m', strictWord)]) {
  assert.deepEqual(parseDocxParagraphsFromXml(xml), expected);
  assert.deepEqual(chunked(parseDocxParagraphsFromXml(xml)), baseline,
    'namespace aliases preserve paragraphs, heading context and actual chunk anchors');
}
assert.throws(() => parseDocxParagraphsFromXml(document('w', 'urn:foreign')), /WordprocessingML document/);
assert.throws(() => parseDocxParagraphsFromXml(document('w').replace('version="1.0"', 'version="1.1"')), /declaration/i);
assert.throws(() => parseDocxParagraphsFromXml('<!-- before -->' + document('w')), /declaration/i);
assert.throws(() => parseDocxParagraphsFromXml(`<w:document xmlns:w="${word}"><w:p><w:p/></w:p></w:document>`), /Nested DOCX paragraphs/);
assert.throws(() => parseDocxParagraphsFromXml(`<w:document xmlns:w="${word}"><w:p><w:t>&nbsp;</w:t></w:p></w:document>`), /entity/i);
for (const value of ['\u0000', '&#0;', '&#xD800;']) {
  assert.throws(() => parseDocxParagraphsFromXml(`<w:document xmlns:w="${word}"><w:p><w:t>${value}</w:t></w:p></w:document>`),
    /XML 1.0|character|entity/i);
}
assert.throws(() => parseDocxParagraphsFromXml(document('w'), { maxChars: 12 }), { code: 'ERR_DOCX_XML_LIMIT' });
assert.throws(() => parseDocxParagraphsFromXml(`<w:document xmlns:w="${word}">${'<x>'.repeat(256)}${'</x>'.repeat(256)}</w:document>`),
  { code: 'ERR_DOCX_XML_LIMIT' });
assert.throws(() => parseDocxParagraphsFromXml(`<w:document xmlns:w="${word}" ${Array.from({ length: 129 }, (_, i) => `a${i}="x"`).join(' ')}/>`),
  { code: 'ERR_DOCX_XML_LIMIT' });
const clock = Object.getOwnPropertyDescriptor(performance, 'now'); let ticks = 0;
try {
  Object.defineProperty(performance, 'now', { configurable: true, value: () => ticks++ * 1000 });
  assert.throws(() => parseDocxParagraphsFromXml(document('w'), { timeoutMs: 100 }), { code: 'EXTRACT_TIMEOUT' });
} finally { if (clock) Object.defineProperty(performance, 'now', clock); else delete performance.now; }

const utf8 = Buffer.from(document('w'));
const utf16Text = document('w').replace('UTF-8', 'UTF-16');
const utf16le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(utf16Text, 'utf16le')]);
const utf16be = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(utf16Text, 'utf16le').swap16()]);
for (const bytes of [utf8, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8])]) {
  assert.deepEqual(parseDocxParagraphsFromXml(decodeDocxXmlBytes(bytes)), expected);
}
for (const bytes of [Buffer.from([0xff, 0xfe, 0, 0]), Buffer.from([0xff]), utf16le, utf16be,
  Buffer.from(document('w').replace('UTF-8', 'ISO-8859-1')), Buffer.from(utf16Text),
  Buffer.from('<?xml version="1.1"?><x/>')]) {
  assert.throws(() => decodeDocxXmlBytes(bytes), { code: 'ERR_DOCX_XML_ENCODING' });
}
const runtime = await loadDocxExtractorRuntime({ refresh: true });
assert.equal(runtime.ok, true, 'this provider regression requires the bootstrapped DOCX dependency');
assert.equal(runtime.backend, 'mammoth', 'the preferred provider positive uses the actual installed Mammoth implementation');
const saved = { ...runtime };
try {
  for (const backend of ['mammoth', 'docx']) {
    runtime.backend = backend;
    for (const xml of [document('w'), document('m'), document(''), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8])]) {
      const result = await extractDocx({ buffer: buildMinimalDocxBuffer([], { xml }) });
      assert.equal(result.ok, true, `${backend}: ${result.reason || result.warnings?.join('; ')}`);
      assert.deepEqual(result.paragraphs, expected); assert.deepEqual(chunked(result.paragraphs), baseline);
      const allowedWarnings = new Set(['paragraph style with ID Heading1 was referenced but not defined in the document',
        'An unrecognised element was ignored: {urn:foreign}group']);
      assert.ok(result.warnings.every(value => allowedWarnings.has(value)), `unexpected provider diagnostics: ${result.warnings.join('; ')}`);
    }
    for (const xml of [document('w', 'urn:foreign'), '<!DOCTYPE x><x/>', utf16le, utf16be,
      Buffer.from(document('w').replace('UTF-8', 'ISO-8859-1'))]) {
      const result = await extractDocx({ buffer: buildMinimalDocxBuffer([], { xml }) });
      assert.equal(result.ok, false); assert.equal(result.reason, 'extract_failed');
      assert.ok(result.warnings.length > 0);
    }
  }
} finally { Object.assign(runtime, saved); }
const { dir } = await prepareIsolatedTestCacheDir('docx-source-byte-admission');
const file = path.join(dir, 'input.docx'); await fs.writeFile(file, buildMinimalDocxBuffer([], { xml: document('w') }));
const readFile = fs.readFile;
try {
  fs.readFile = function (target, ...args) {
    assert.notEqual(path.resolve(String(target)), file, 'the direct pathname adapter must use bounded descriptor admission');
    return readFile.call(fs, target, ...args);
  };
  const result = await extractDocx({ filePath: file }); assert.equal(result.ok, true); assert.deepEqual(result.paragraphs, expected);
  const refused = await extractDocx({ filePath: file, policy: { maxBytesPerFile: 16 } });
  assert.equal(refused.ok, false); assert.equal(refused.reason, 'oversize');
} finally { fs.readFile = readFile; }
console.log('DOCX namespace, physical paragraph, encoding and parser-bound controls retain real chunk parity');
