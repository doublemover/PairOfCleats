import assert from 'node:assert/strict';
import { buildLspLineIndex, exactRangeToOffsets, offsetToLspPosition } from '../../../src/integrations/tooling/lsp/positions.js';
import { parseInlayHintSignalInfo } from '../../../src/integrations/tooling/providers/lsp/semantic-signals.js';
import { isIncompleteTypePayload, mergeSignatureInfo } from '../../../src/integrations/tooling/providers/lsp/hover-types/payload-policy.js';
import { buildTargetLookupIndex, findTargetForOffsets, findTargetForOffsetsLinear } from '../../../src/integrations/tooling/providers/lsp/target-index.js';

const text = '😀A\r\nβ\rC\u2028D\n';
const lines = buildLspLineIndex(text);
assert.deepEqual(lines, [0, 5, 7, 11]);
for (const positionEncoding of ['utf-8', 'utf-16', 'utf-32']) {
  for (const offset of [0, 2, 3, 5, 6, 7, 8, 9, 10, 11]) {
    const position = offsetToLspPosition(lines, text, offset, positionEncoding);
    assert.deepEqual(exactRangeToOffsets(lines, { start: position, end: position }, { text, positionEncoding }), { start: offset, end: offset });
  }
  assert.equal(exactRangeToOffsets(lines, { start: { line: 0, character: 999 }, end: { line: 0, character: 999 } }, { text, positionEncoding }), null);
  assert.equal(exactRangeToOffsets(lines, { start: { line: 8, character: 0 }, end: { line: 8, character: 0 } }, { text, positionEncoding }), null);
}
assert.deepEqual(offsetToLspPosition(lines, text, 2, 'utf-8'), { line: 0, character: 4 });
assert.deepEqual(offsetToLspPosition(lines, text, text.length, 'utf-32'), { line: 3, character: 0 });
const targets = [
  { virtualRange: { start: 0, end: 10 }, symbolHint: { name: 'left' } },
  { virtualRange: { start: 10, end: 20 }, symbolHint: { name: 'right' } },
  { virtualRange: { start: 11, end: 15 }, symbolHint: { name: 'inner' } }
];
const lookup = buildTargetLookupIndex(targets);
for (const [range, expected] of [[{ start: 9, end: 10 }, targets[0]],
  [{ start: 10, end: 11 }, targets[1]], [{ start: 10, end: 10 }, targets[1]],
  [{ start: 11, end: 12 }, targets[2]], [{ start: 20, end: 20 }, null],
  [{ start: 16, end: 14 }, null]]) {
  assert.equal(findTargetForOffsets(lookup, range), expected);
  assert.equal(findTargetForOffsetsLinear(targets, range), expected);
}
const source = 'function f(a) { const value = 1; function inner() { return 1; } return value; }';
const lineIndex = buildLspLineIndex(source), parameterEnd = source.indexOf('a)') + 1;
const hint = (offset, label, kind = 1) => ({ position: offsetToLspPosition(lineIndex, source, offset), label, kind });
const input = { text: source, lineIndex, targetRange: { start: 0, end: source.length }, paramNames: ['a'],
  declarationNameRange: { start: 9, end: 10 }, languageId: 'javascript' };
const bodyOnly = parseInlayHintSignalInfo({ ...input, hints: [hint(source.indexOf('value') + 5, ': number'),
  hint(source.indexOf('inner') + 5, ': string'), hint(parameterEnd, 'a:', 2)] });
assert.equal(bodyOnly.returnType, undefined);
assert.equal(bodyOnly.hintCount, 0);
assert.equal(bodyOnly.observations.length, 3);
assert.equal(isIncompleteTypePayload(bodyOnly, { symbolKind: 12 }).incomplete, true);
const qualified = parseInlayHintSignalInfo({ ...input, hints: [hint(parameterEnd, ': number'), hint(source.indexOf(')') + 1, ': boolean')] });
assert.equal(qualified.returnType, 'boolean');
assert.equal(qualified.paramTypes.a[0].type, 'number');
assert.equal(isIncompleteTypePayload(qualified, { symbolKind: 12 }).missingReturn, true, 'hint cannot suppress a richer signature request');
const merged = mergeSignatureInfo(qualified, { signature: 'f(a: number): Promise<string>', returnType: 'Promise<string>', paramNames: ['a'] });
assert.equal(merged.returnType, 'Promise<string>');
assert.notEqual(merged.returnTypeSource, 'lsp_inlay');
console.log('protocol lines, encoded exact ranges, half-open targets and qualified inlay roles');
