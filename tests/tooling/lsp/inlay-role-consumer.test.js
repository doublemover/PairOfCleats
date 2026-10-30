import assert from 'node:assert/strict';
import ts from 'typescript';
import { getLanguageForFile } from '../../../src/index/language-registry.js';
import { buildJsChunks } from '../../../src/lang/javascript/chunks.js';
import { prepareChunkIds } from '../../../src/index/build/file-processor/process-chunks/ids.js';
import { buildLineIndex } from '../../../src/shared/lines.js';
import { buildLspLineIndex, offsetToLspPosition } from '../../../src/integrations/tooling/lsp/positions.js';
import { parseInlayHintSignalInfo } from '../../../src/integrations/tooling/providers/lsp/semantic-signals.js';
import { mergeSignatureInfo, isIncompleteTypePayload } from '../../../src/integrations/tooling/providers/lsp/hover-types/payload-policy.js';
import { resolveRecordCandidate } from '../../../src/integrations/tooling/providers/lsp/hover-types/merge.js';
import { applyToolingTypes } from '../../../src/index/type-inference-crossfile/tooling-types.js';
import { assembleFlowFixture } from '../../helpers/chunk-flow-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv();

const text = '/* 😀 */ function f(value) {\r\n const local = 1; function nested(other) { return "nested"; }\r\n return value;\r\n}\r\n';
const lang = getLanguageForFile('.js', 'fixture.js'), options = { javascript: { parser: 'babel' } };
const context = await lang.prepare({ text, ext: '.js', relPath: 'fixture.js', mode: 'code', options });
const chunks = buildJsChunks(text, { ...options, ast: context.jsAst });
await prepareChunkIds({ chunks, text, relKey: 'fixture.js', containerExt: '.js', containerLanguageId: 'javascript',
  lineIndex: buildLineIndex(text), vfsManifestConcurrency: 1, strict: true });
const chunk = chunks.find(row => row.name === 'f'); assert.ok(chunk);
const sourceSignature = 'function f(value: string): string';
const parsed = ts.createSourceFile('signature.ts', sourceSignature + ' { throw 0; }', ts.ScriptTarget.Latest, true);
assert.deepEqual(parsed.parseDiagnostics, []);
const declaration = parsed.statements[0], richer = { signature: sourceSignature, paramNames: ['value'],
  returnType: declaration.type.getText(parsed), paramTypes: { value: declaration.parameters[0].type.getText(parsed) } };
const lineIndex = buildLspLineIndex(text), parameterEnd = text.indexOf('value)') + 5, returnPoint = text.indexOf(')') + 1;
for (const encoding of ['utf-8', 'utf-16', 'utf-32']) {
  const hint = (offset, label, kind = 1) => ({ position: offsetToLspPosition(lineIndex, text, offset, encoding), label, kind });
  const input = { text, lineIndex, targetRange: { start: chunk.start, end: chunk.end }, positionEncoding: encoding,
    paramNames: ['value'], declarationNameRange: { start: text.indexOf('f(value'), end: text.indexOf('f(value') + 1 }, languageId: 'javascript' };
  const locals = parseInlayHintSignalInfo({ ...input, hints: [hint(text.indexOf('local') + 5, ': number'),
    hint(text.indexOf('nested(other)') + 'nested(other)'.length, ': String'), hint(parameterEnd, 'value:', 2),
    hint(chunk.end, ': Boolean'), { position: { line: 99999, character: 0 }, label: ': number', kind: 1 }] });
  assert.equal(locals.returnType, undefined); assert.equal(locals.paramTypes, undefined); assert.equal(locals.hintCount, 0);
  const valid = parseInlayHintSignalInfo({ ...input, hints: [hint(parameterEnd, [{ value: ': ' }, { value: 'Boolean' }]),
    hint(returnPoint, [{ value: '-> ' }, { value: 'Boolean' }])] });
  assert.equal(valid.returnType, 'Boolean'); assert.equal(valid.paramTypes.value[0].type, 'Boolean');
  assert.equal(isIncompleteTypePayload(valid, { symbolKind: 12 }).missingReturn, true);
  const base = { signature: 'function f(value)', paramNames: ['value'] };
  const candidate = async (info, fallback) => {
    let fallbackCalls = 0;
    const record = { target: { chunkRef: { chunkUid: chunk.chunkUid, file: 'fixture.js', range: { start: chunk.start, end: chunk.end } } },
      symbol: { name: 'f', kind: 12 }, info: mergeSignatureInfo(base, info), inlayHintsRequested: true, inlayHintsSucceeded: true,
      ...(fallback ? { sourceSignature } : {}) };
    const value = await resolveRecordCandidate({ record, recordIndex: 0, strict: true, cmd: 'inlay-role-fixture', languageId: 'javascript',
      hoverMetrics: { fallbackUsed: 0 }, unresolvedRate: 0, stabilityTier: 'stable', providerConfidenceBias: 0,
      parseSignatureCached: signature => { fallbackCalls++; assert.equal(signature, sourceSignature); return richer; } });
    return { value, fallbackCalls };
  };
  const hinted = await candidate(valid, false);
  assert.equal(hinted.value.payload.returnType, 'Boolean'); assert.equal(hinted.value.evidenceTier, 'hinted');
  assert.equal(hinted.value.payload.paramTypes.value[0].confidence, 0.55);
  for (const signal of [locals, valid]) {
    const { value, fallbackCalls } = await candidate(signal, true);
    assert.equal(fallbackCalls, 1, 'unqualified or hint-only evidence cannot suppress the richer signature path');
    assert.equal(value.payload.returnType, 'string'); assert.notEqual(value.payload.returnType, 'number');
    const target = { ...chunk, docmeta: lang.extractDocMeta({ text, chunk, context }) };
    applyToolingTypes({ byChunkUid: new Map([[chunk.chunkUid, value]]), chunkByUid: new Map([[chunk.chunkUid, target]]) });
    const payload = assembleFlowFixture({ text, chunk: target, docmeta: target.docmeta, lang: 'javascript', ext: '.js' });
    const restored = JSON.parse(JSON.stringify(payload));
    assert.deepEqual(restored.docmeta.inferredTypes.returns.map(row => row.type), ['string']);
    assert.deepEqual(restored.docmeta.inferredTypes.params.value.map(row => row.type), ['string']);
  }
}
console.log('Encoded source-owned inlay roles retain hint strength, permit richer fallback and reach real callable metadata without local/nested return invention.');
