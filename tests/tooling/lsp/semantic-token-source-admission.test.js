import assert from 'node:assert/strict';
import { buildLspLineIndex, offsetToLspPosition } from '../../../src/integrations/tooling/lsp/positions.js';
import { decodeSemanticTokens, findSemanticTokenAtPosition, normalizeSemanticTokenClass } from '../../../src/integrations/tooling/providers/lsp/semantic-signals.js';
import { buildTargetLookupIndex } from '../../../src/integrations/tooling/providers/lsp/target-index.js';
import { createEmptyHoverMetricsResult, processDocumentTypes } from '../../../src/integrations/tooling/providers/lsp/hover-types.js';

// Authored only: actual protocol decoding and document enrichment with a controlled
// client. No external server, native parser or project execution is required.
const legend = { tokenTypes: ['class', 'function'], tokenModifiers: ['declaration'] };
const decode = (data, options = {}) => decodeSemanticTokens({ data, legend, ...options });
const decoded = decode([0, 0, 1, 0, 1, 0, 1, 1, 1, 0]);
assert.equal(findSemanticTokenAtPosition(decoded, { line: 0, character: 0 })?.semanticClass, 'class');
assert.equal(findSemanticTokenAtPosition(decoded, { line: 0, character: 1 })?.semanticClass, 'function',
  'the preceding token ends before the adjacent declaration begins');
assert.equal(findSemanticTokenAtPosition(decoded, { line: 0, character: 2 }), null);
assert.equal(findSemanticTokenAtPosition(decoded, { line: '0', character: 0 }), null);
assert.equal(findSemanticTokenAtPosition(decoded, { line: 0, character: 0.5 }), null);
assert.equal(findSemanticTokenAtPosition(decode([0, 1, 0, 0, 0]), { line: 0, character: 1 }), null);
assert.equal(findSemanticTokenAtPosition([{ line: 0, startCharacter: 0, endCharacter: 1, length: '1' }], { line: 0, character: 0 }), null);
for (const tokenType of ['constructor', '__proto__', 'toString', { toString: () => 'class' }]) {
  assert.equal(normalizeSemanticTokenClass({ providerId: 'clangd', tokenType }), null);
}
assert.equal(normalizeSemanticTokenClass({ providerId: 'constructor', tokenType: 'function' }), 'function');
assert.equal(decode([0, 0, 1, 0, 0], { legend: { tokenTypes: ['constructor'], tokenModifiers: [] } })[0].semanticClass, null);
for (const value of [-1, 0.5, '0', null, NaN, Infinity, 2147483648]) {
  for (let field = 0; field < 5; field++) {
    const row = [0, 0, 1, 0, 0]; row[field] = value;
    assert.throws(() => decode(row), /Invalid LSP semantic token/, `invalid field ${field} must not be coerced`);
  }
}
for (const data of [null, {}, [0], [0, 0, 1, 0, 0, 1], [0, 0, 1, 2, 0], [0, 0, 1, 0, 2],
  [0, 0, 1, 0, 0, -1, 0, 1, 1, 0], [2147483647, 0, 1, 0, 0, 1, 0, 1, 0, 0],
  [0, 2147483647, 1, 0, 0]]) {
  assert.throws(() => decode(data), /LSP semantic token/, 'an invalid chain cannot return an accepted prefix');
}
assert.throws(() => decode([], { legend: { tokenTypes: new Array(1), tokenModifiers: [] } }), /legend/);
const longModifiers = Array.from({ length: 33 }, (_, index) => `modifier${index}`);
const wideLegend = { tokenTypes: ['class'], tokenModifiers: longModifiers };
assert.deepEqual(decode([0, 0, 1, 0, 1], { legend: wideLegend })[0].tokenModifiers, ['modifier0']);
assert.deepEqual(decode([0, 0, 1, 0, 2 ** 30], { legend: wideLegend })[0].tokenModifiers, ['modifier30']);

const unicodeText = '😀f\r\ng';
const unicodeLines = buildLspLineIndex(unicodeText);
for (const [positionEncoding, start] of [['utf-8', 4], ['utf-16', 2], ['utf-32', 1]]) {
  assert.equal(decode([0, start, 1, 0, 0], { lineIndex: unicodeLines, text: unicodeText, positionEncoding })[0].startCharacter, start);
}
for (const [data, positionEncoding] of [
  [[0, 1, 1, 0, 0], 'utf-16'], [[0, 1, 1, 0, 0], 'utf-8'],
  [[0, 0, 3, 0, 0], 'utf-8'], [[0, 2, 2, 0, 0], 'utf-16'], [[2, 0, 1, 0, 0], 'utf-16']
]) assert.throws(() => decode(data, { lineIndex: unicodeLines, text: unicodeText, positionEncoding }), /exact source span/);
assert.throws(() => decode([], { text: unicodeText }), /Incomplete/);

const enrich = async ({ payload, text = 'xf', offset = 1, positionEncoding = 'utf-16', tokenLegend = legend }) => {
  const virtualPath = 'semantic-source.js', uri = 'poc-vfs:///semantic-source.js', chunkUid = 'semantic-source-chunk';
  const byChunkUid = {}, logs = [], hoverMetrics = createEmptyHoverMetricsResult();
  const lines = buildLspLineIndex(text);
  const selectionRange = { start: offsetToLspPosition(lines, text, offset, positionEncoding),
    end: offsetToLspPosition(lines, text, offset + 1, positionEncoding) };
  const target = { virtualRange: { start: 0, end: text.length }, chunkRef: { chunkUid, file: virtualPath }, symbolHint: { name: 'f', kind: 'function' } };
  await processDocumentTypes({ doc: { virtualPath, text, languageId: 'javascript', docHash: 'semantic-source' }, cmd: 'semantic-source-fixture',
    client: { notify() {}, async request(method) {
      if (method === 'textDocument/documentSymbol') return [{ name: 'f', kind: 12, detail: 'f(): number', range: selectionRange, selectionRange }];
      assert.equal(method, 'textDocument/semanticTokens/full'); return payload;
    } }, guard: { isOpen: () => false, run: async fn => fn({ timeoutMs: 1000 }) }, log: message => logs.push(message), strict: true,
    parseSignature: detail => ({ signature: detail, returnType: 'number', paramNames: [] }), uri, languageId: 'javascript', openDocs: new Map(),
    targetIndexesByPath: new Map([[virtualPath, buildTargetLookupIndex([target])]]), byChunkUid, signatureParseCache: new Map(),
    hoverEnabled: false, semanticTokensEnabled: true, signatureHelpEnabled: false, inlayHintsEnabled: false,
    definitionEnabled: false, typeDefinitionEnabled: false, referencesEnabled: false, hoverRequireMissingReturn: true,
    hoverLimiter: async fn => fn(), requestCacheEntries: new Map(), requestCachePersistedKeys: new Set(),
    semanticTokensLegend: tokenLegend, hoverControl: { disabledGlobal: false }, hoverFileStats: new Map(),
    hoverLatencyMs: [], hoverMetrics, checks: [], checkFlags: {}, positionEncoding });
  assert.equal(byChunkUid[chunkUid].payload.returnType, 'number', 'valid signature enrichment survives unavailable token evidence');
  return { entry: byChunkUid[chunkUid], logs, hoverMetrics };
};
const valid = await enrich({ payload: { data: [0, 1, 1, 0, 1] } });
assert.equal(valid.entry.symbolRef.kind, 'class');
assert.equal(valid.entry.provenance.stages.semanticTokens.succeeded, true);
assert.equal(valid.hoverMetrics.semanticTokensSucceeded, 1);
const adjacent = await enrich({ payload: { data: [0, 0, 1, 0, 0] } });
assert.equal(adjacent.entry.symbolRef.kind, 'function');
assert.equal(adjacent.entry.provenance.stages.semanticTokens.succeeded, false);
for (const payload of [{ data: [0, 1, 1, 0, 1, 0] }, { data: [0, 0, 3, 0, 0] }, { data: [0, '1', 1, 0, 0] }, {}, undefined]) {
  const rejected = await enrich({ payload });
  assert.equal(rejected.entry.symbolRef.kind, 'function');
  assert.equal(rejected.hoverMetrics.semanticTokensSucceeded, 0);
  assert.equal(rejected.entry.provenance.stages.semanticTokens.succeeded, false);
  assert.ok(rejected.logs.some(message => message.includes('stage=semantic_tokens') && message.includes('request:failed')));
}
const empty = await enrich({ payload: null });
assert.equal(empty.hoverMetrics.semanticTokensSucceeded, 1, 'a protocol null is a valid empty response');
assert.equal(empty.entry.provenance.stages.semanticTokens.succeeded, false, 'empty response does not classify a declaration');
for (const [positionEncoding, start] of [['utf-8', 4], ['utf-16', 2], ['utf-32', 1]]) {
  const result = await enrich({ payload: { data: [0, start, 1, 0, 0] }, text: '😀f', offset: 2, positionEncoding });
  assert.equal(result.entry.symbolRef.kind, 'class');
}
const splitScalar = await enrich({ payload: { data: [0, 1, 2, 0, 0] }, text: '😀f', offset: 2 });
assert.equal(splitScalar.hoverMetrics.semanticTokensSucceeded, 0);
assert.equal(splitScalar.entry.symbolRef.kind, 'function');
console.log('semantic token admission preserves exact source spans, relative anchors and half-open attribution');
