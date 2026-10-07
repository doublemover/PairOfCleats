#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  decodeSemanticTokens,
  findSemanticTokenAtPosition,
  normalizeSemanticTokenClass,
  parseInlayHintSignalInfo
} from '../../../src/integrations/tooling/providers/lsp/semantic-signals.js';
import { buildLineIndex } from '../../../src/shared/lines.js';

assert.equal(
  normalizeSemanticTokenClass({ providerId: 'clangd', tokenType: 'function' }),
  'function',
  'expected clangd function token normalization'
);
assert.equal(
  normalizeSemanticTokenClass({ providerId: 'rust-analyzer', tokenType: 'struct' }),
  'struct',
  'expected rust-analyzer struct token normalization'
);

const decoded = decodeSemanticTokens({
  providerId: 'clangd',
  legend: {
    tokenTypes: ['namespace', 'class', 'function', 'parameter'],
    tokenModifiers: ['declaration']
  },
  data: [0, 9, 3, 2, 1, 0, 4, 1, 3, 1]
});
assert.equal(decoded.length, 2, 'expected two decoded semantic tokens');
assert.equal(decoded[0]?.semanticClass, 'function', 'expected semantic token class mapping');
assert.equal(
  findSemanticTokenAtPosition(decoded, { line: 0, character: 10 })?.semanticClass,
  'function',
  'expected semantic token lookup by cursor position'
);

const text = 'function add(a, b) { return a + b; }\n';
const lineIndex = buildLineIndex(text);
const inlayInfo = parseInlayHintSignalInfo({
  hints: [{
    position: { line: 0, character: 13 },
    label: 'a: integer'
  }, {
    position: { line: 0, character: 16 },
    label: 'b: integer'
  }, {
    position: { line: 0, character: 18 },
    label: '-> integer'
  }],
  lineIndex,
  text,
  targetRange: { start: 0, end: text.length },
  paramNames: ['a', 'b'],
  languageId: 'javascript'
});
assert.equal(inlayInfo?.returnType, 'number', 'expected inlay return type normalization');
assert.equal(inlayInfo?.paramTypes?.a?.[0]?.type, 'number', 'expected inlay param type normalization');
assert.equal(inlayInfo?.paramTypes?.a?.[0]?.source, 'lsp_inlay', 'expected inlay hint provenance source');

console.log('LSP semantic signals test passed');
