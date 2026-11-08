#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { parseTypeScriptSignature, extractTypeScriptParams, extractTypeScriptParamTypes } from '../../../src/lang/typescript/signature.js';
import { resolveRecordCandidate } from '../../../src/integrations/tooling/providers/lsp/hover-types/merge.js';
import { normalizeProviderPayload } from '../../../src/index/tooling/provider-output-contract.js';
import { applyToolingTypes } from '../../../src/index/type-inference-crossfile/tooling-types.js';
import { buildCrossFileFingerprint, writeCrossFileInferenceCache, readCrossFileInferenceCache } from '../../../src/index/type-inference-crossfile/cache.js';
import { filterChunks } from '../../../src/retrieval/output.js';
import { buildFilterIndex } from '../../../src/retrieval/filter-index.js';
import { canonicalizeTypeText } from '../../../src/shared/type-normalization.js';
import { mergeTypeEntries } from '../../../src/shared/type-entry-utils.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('lsp-type-identity-handoff');
const types = ['Boolean', 'boolean', 'String', 'string', 'Number', 'number', 'Boolean | boolean',
  '"a  | b"', '"a | b"', 'User', 'user', 'integer', 'float'];
const text = types.map((type, index) => `export declare function typed${index}(value: ${type}): ${type};`).join('\n');
const source = ts.createSourceFile('types.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
assert.equal(source.parseDiagnostics.length, 0, 'the supported compiler must independently admit the fixture syntax');
const chunks = [], byChunkUid = new Map(), entryByUid = new Map();
for (const [index, node] of source.statements.entries()) {
  assert.ok(ts.isFunctionDeclaration(node));
  const signature = node.getText(source), name = node.name.text;
  const oracle = node.type.getText(source), parameter = node.parameters[0].type.getText(source);
  assert.equal(oracle, types[index]); assert.equal(parameter, types[index]);
  const parsed = parseTypeScriptSignature(signature);
  const chunkUid = `ck64:v1:type-identity:types.ts:${name}`;
  const chunkRef = { chunkUid, file: 'types.ts', range: { start: node.getStart(source), end: node.end } };
  const record = { info: { signature, returnType: parsed.returns, paramNames: extractTypeScriptParams(signature),
    paramTypes: extractTypeScriptParamTypes(signature) }, hoverSucceeded: true,
  symbol: { name, kind: 12 }, target: { chunkRef, virtualPath: 'types.ts', symbolHint: { name, kind: 'function' } } };
  const candidate = await resolveRecordCandidate({ record, recordIndex: index, strict: true,
    cmd: 'source-qualified-fixture', languageId: 'typescript', hoverMetrics: {}, unresolvedRate: 0,
    stabilityTier: 'stable', providerConfidenceBias: 0,
    parseSignatureCached() { assert.fail('complete provider evidence must not require source fallback'); } });
  assert.equal(candidate.payload.returnType, oracle, 'provider normalization must preserve compiler-retained return annotations');
  assert.deepEqual(candidate.payload.paramTypes.value.map(row => row.type), [parameter]);
  assert.equal(candidate.payload.paramTypes.value[0].originalText, parameter);
  const payload = normalizeProviderPayload(candidate.payload);
  assert.deepEqual(normalizeProviderPayload(payload), payload, 'repeated payload admission is stable');
  byChunkUid.set(chunkUid, { ...candidate, payload }); entryByUid.set(chunkUid, {});
  chunks.push({ id: index, chunkUid, file: 'types.ts', name, kind: 'FunctionDeclaration',
    start: node.getStart(source), end: node.end, lang: 'typescript', docmeta: { returns: 'stale-declaration' } });
}
const applied = applyToolingTypes({ byChunkUid, chunkByUid: new Map(chunks.map(row => [row.chunkUid, row])), entryByUid });
assert.equal(applied.enriched, types.length);
const assertFacts = rows => {
  const filters = buildFilterIndex(rows);
  for (const [index, type] of types.entries()) {
    assert.deepEqual(filterChunks(rows, { returnType: type }, filters).map(row => row.id), [index], type);
    assert.equal(rows[index].docmeta.inferredTypes.returns[0].type, type);
    assert.equal(rows[index].docmeta.inferredTypes.params.value[0].type, type);
    assert.deepEqual(entryByUid.get(rows[index].chunkUid).paramTypes.value, [type]);
  }
  assert.deepEqual(filterChunks(rows, { returnType: 'stale-declaration' }, filters), [], 'actual tooling facts retain precedence');
  assert.deepEqual(filterChunks(rows, { returnType: 'Boolean|boolean' }, filters).map(row => row.id), [6]);
};
assertFacts(chunks);
const cacheDir = path.join(dir, 'cross-file'), cachePath = path.join(cacheDir, 'output-cache.json');
const fingerprint = buildCrossFileFingerprint({ chunks, enableTypeInference: true, enableRiskCorrelation: false,
  useTooling: true, fileRelations: null });
await writeCrossFileInferenceCache({ cacheDir, cachePath, chunks, crossFileFingerprint: fingerprint,
  stats: { inferredReturns: types.length }, maxBytes: 1024 * 1024 });
const replay = chunks.map(({ docmeta, ...chunk }) => ({ ...chunk, docmeta: {} }));
const cached = await readCrossFileInferenceCache({ cachePath, chunks: replay, crossFileFingerprint: fingerprint, requireComplete: true });
assert.ok(cached, 'the real durable cache must retain the applied payload');
assertFacts(replay);
for (const languageId of ['javascript', 'typescript', 'tsx', 'jsx']) {
  for (const [primitive, boxed] of [['boolean', 'Boolean'], ['string', 'String'], ['number', 'Number']]) {
    for (const ordered of [[primitive, boxed], [boxed, primitive]]) {
      const merged = mergeTypeEntries([], ordered.map(type => ({ type, languageId, source: 'tooling', confidence: 0.9 })));
      assert.equal(merged.list.length, 2); assert.equal(merged.truncated, false);
      assert.deepEqual(mergeTypeEntries([], merged.list).list, merged.list);
    }
  }
  for (const value of ['integer', 'float', 'custom.String', 'User', 'user', '"a  | b"']) {
    assert.equal(canonicalizeTypeText(value, { languageId }).canonicalText, value);
  }
}
await fs.access(cachePath);
console.log('Compiler-retained type identity survives LSP merge, provider admission, tooling application, durable replay and strict filters.');
