#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildTreeSitterChunks } from '../../../src/lang/tree-sitter/chunking.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';
import { sha1 } from '../../../src/shared/hash.js';
import { getLanguageForFile } from '../../../src/index/language-registry.js';
import { extractDocMeta as extractJavaScriptDocMeta } from '../../../src/lang/javascript/docmeta.js';
import { buildMapMembers } from '../../../src/map/build-map/members.js';
import { resolveChunkDocmeta } from '../../../src/retrieval/output/filters/meta.js';
import { enrichFlowFixture, assembleFlowFixture } from '../../helpers/chunk-flow-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const options = { treeSitter: { enabled: true, strict: true, adaptive: false, chunkCache: true },
  astDataflowEnabled: false, controlFlowEnabled: false };
const cases = [
  { languageId: 'javascript', ext: '.js', prefix: '', rows: [
    ['plain', 'function plain(finalarg)', ' { return bodyonlytoken(finalarg); }'],
    ['destructured', 'function destructured({alpha, beta}, finalarg = 1)', ' { return bodyonlytoken(finalarg); }'],
    ['quoted', 'function quoted(value = "punctuation);{=>", finalarg = 1)', ' { return bodyonlytoken(finalarg); }'],
    ['commented', 'function commented(/* ; { => */ value, finalarg)', ' { return bodyonlytoken(finalarg); }'],
    ['multiline', 'function multiline(\r\n {left, right},\r\n finalarg = 1\r\n)', ' { return bodyonlytoken(finalarg); }']
  ] },
  { languageId: 'typescript', ext: '.ts', prefix: '', rows: [
    ['typed', 'function typed(value: {name: string; nested: {id: number}}, finalarg: number): {name: string}',
      ' { return bodyonlytoken(finalarg); }'],
    ['quotedtype', 'function quotedtype(value: "left;{right", finalarg: string): string', ' { return bodyonlytoken(finalarg); }'],
    ['multiline', 'function multiline(\r\n value: { name: string },\r\n finalarg: number\r\n): number',
      ' { return bodyonlytoken(finalarg); }']
  ] },
  { languageId: 'clike', ext: '.c', prefix: 'typedef int Count; struct Item { int field; };\n', rows: [
    ['getCount', 'Count getCount(Count finalarg)', ' { return bodyonlytoken(finalarg); }'],
    ['otherCount', 'Count otherCount(Count finalarg)', ' { return bodyonlytoken(finalarg); }'],
    ['pointer', 'struct Item *pointer(struct Item *finalarg)', ' { return bodyonlytoken(finalarg); }'],
    ['prototype', 'Count prototype(Count finalarg);', ''],
    ['receiver', 'void receiver(Count (*callback)(Count value), Count finalarg);', '']
  ], suffix: 'Count (*variable)(Count finalarg);\ntypedef Count (*Handler)(Count value);\n' },
  { languageId: 'cpp', ext: '.cpp', prefix: '', rows: [
    ['wrapped', 'template <typename T>\nT wrapped(T finalarg)', ' { return bodyonlytoken(finalarg); }'],
    ['prototype', 'int prototype(int finalarg);', '']
  ], suffix: 'int (*variable)(int finalarg);\n' }
];
for (const { languageId, ext, prefix, rows, suffix = '' } of cases) {
  const text = prefix + rows.map(([, header, body]) => header + body + '\n').join('') + suffix;
  const lang = getLanguageForFile(ext, 'fixture' + ext);
  const expected = new Map(rows.map(([name, header]) => [name, header.replace(/\s+/gu, ' ').trim()]));
  for (const useQueries of [false, true]) {
    const nativeOptions = { ...options, treeSitterCacheKey: 'signature-projection:' + sha1(text),
      treeSitter: { ...options.treeSitter, useQueries } };
    const chunks = buildTreeSitterChunks({ text, languageId, options: nativeOptions });
    assert.ok(chunks?.length, languageId + ': real native declarations are required');
    const payloads = [];
    for (const [name, signature] of expected) {
      const matches = chunks.filter(chunk => chunk.name === name && /Function|Method/u.test(chunk.kind));
      assert.equal(matches.length, 1, `${languageId}: ${name} has one source-owned callable identity`);
      const chunk = matches[0];
      assert.equal(chunk.meta.signature, signature, `${languageId}: ${name} retains its native header`);
      assert.ok(signature.length <= 2000);
      assert.equal(signature.includes('bodyonlytoken'), false);
      const docmeta = enrichFlowFixture({ text, chunk, lang, context: {}, options: nativeOptions, enabled: false });
      assert.equal(docmeta.signature, signature, 'registered enrichment must consume the native declaration preview');
      const payload = assembleFlowFixture({ text, chunk, docmeta, lang: lang.id, ext, emitFieldTokens: true });
      assert.equal(payload.metaV2.name, name); assert.equal(payload.metaV2.signature, signature);
      assert.equal(resolveChunkDocmeta(payload).signature, signature, 'the real retrieval projection preserves the same signature');
      assert.ok(payload.fieldTokens.signature.includes('finalarg'), 'the last indexed signature parameter survives punctuation');
      assert.equal(payload.fieldTokens.signature.includes('bodyonlytoken'), false, 'body tokens stay out of the signature field');
      payloads.push(payload);
    }
    if (ext === '.c' || ext === '.cpp') {
      for (const name of ['Count', 'callback', 'variable', 'Handler']) {
        assert.equal(chunks.some(chunk => chunk.name === name && /Function|Method/u.test(chunk.kind)), false,
          `${name}: return types, nested parameters and pointer bindings cannot supply callable names`);
      }
    }
    assert.equal(new Set(payloads.map(row => row.chunkUid)).size, rows.length);
    const warnings = [];
    const mapped = buildMapMembers({ chunkMeta: payloads, repoMap: [], fileMeta: [], fileRelations: [],
      intern: value => value, strict: true, warnings });
    assert.deepEqual(warnings, []);
    assert.equal(mapped.memberById.size, rows.length);
    for (const member of mapped.memberById.values()) assert.equal(member.signature, expected.get(member.name));
    const cacheHits = treeSitterState.metrics.chunkCacheHits;
    assert.deepEqual(buildTreeSitterChunks({ text, languageId, options: nativeOptions }), chunks,
      'warm native reuse retains exact declaration identities and previews');
    assert.equal(treeSitterState.metrics.chunkCacheHits, cacheHits + 1, 'the warm control must observe a real native chunk-cache hit');
  }
}
// Existing source-qualified JavaScript declaration records remain the preferred
// producer when supplied. Bare fallback still supports ordinary legacy callers.
const legacySource = 'function plain(finalarg) {}';
assert.equal(extractJavaScriptDocMeta(legacySource, { start: 0, end: legacySource.length }).signature, 'function plain(finalarg)');
assert.equal(extractJavaScriptDocMeta(legacySource, { start: 0, end: legacySource.length, meta: { signature: '' } }).signature,
  'function plain(finalarg)');
console.log('Native signatures retain exact field, retrieval and map projections; C/C++ callable roles preserve independent names.');
