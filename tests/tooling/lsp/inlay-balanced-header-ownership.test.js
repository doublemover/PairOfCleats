import assert from 'node:assert/strict';
import { buildLspLineIndex, offsetToLspPosition } from '../../../src/integrations/tooling/lsp/positions.js';
import { createInlayOwnership } from '../../../src/integrations/tooling/providers/lsp/inlay-ownership.js';
import { parseInlayHintSignalInfo } from '../../../src/integrations/tooling/providers/lsp/semantic-signals.js';
import { isIncompleteTypePayload, mergeSignatureInfo } from '../../../src/integrations/tooling/providers/lsp/hover-types/payload-policy.js';

// Authored only: actual hint parser and its existing enrichment completeness gate.
const parse = (text, names, entries, positionEncoding = 'utf-16') => {
  const lineIndex = buildLspLineIndex(text);
  const nameStart = text.indexOf('outer'), declarationNameRange = { start: nameStart, end: nameStart + 5 };
  return parseInlayHintSignalInfo({ text, lineIndex, paramNames: names, positionEncoding, declarationNameRange,
    languageId: 'typescript', targetRange: { start: 0, end: text.length },
    hints: entries.map(([offset, label]) => ({ position: offsetToLspPosition(lineIndex, text, offset, positionEncoding), kind: 1, label })) });
};
const source = 'function outer(a = {first: 1, b: 2}, second = [1, 2], third) { return third; }';
const propertyEnd = source.indexOf('b:') + 1, thirdEnd = source.indexOf('third)') + 5;
const input = [[propertyEnd, ': string'], [thirdEnd, ': number'], [source.indexOf(') {') + 1, ': boolean']];
const qualified = parse(source, ['a', 'b', 'second', 'third'], input);
assert.equal(qualified.paramTypes.b, undefined, 'a property after a default-object comma cannot become a parameter');
assert.equal(qualified.paramTypes.third[0].type, 'number');
assert.equal(qualified.returnType, 'boolean');
assert.equal(qualified.observations.length, 1);
assert.equal(isIncompleteTypePayload(qualified, { symbolKind: 12 }).missingReturn, true, 'hint-only return still leaves richer evidence open');
const bodyOnly = parse(source, ['a', 'b', 'second', 'third'], [[propertyEnd, ': string']]);
assert.equal(bodyOnly.paramTypes, undefined); assert.equal(bodyOnly.returnType, undefined);
assert.equal(bodyOnly.hintCount, 0); assert.equal(bodyOnly.observations[0].reason, 'unqualified-inlay-role');
assert.equal(isIncompleteTypePayload(bodyOnly, { symbolKind: 12 }).incomplete, true);
const rich = mergeSignatureInfo(bodyOnly, { signature: 'outer(a: object, second: number[], third: number): Promise<string>',
  returnType: 'Promise<string>', paramNames: ['a', 'second', 'third'] });
assert.equal(rich.returnType, 'Promise<string>', 'unqualified labels cannot suppress or replace the richer forward consumer');
const destructured = 'function outer({value: local}, ordinary) { return local; }';
const destructuringHints = parse(destructured, ['value', 'local', 'ordinary'], [
  [destructured.indexOf('value:') + 5, ': string'], [destructured.indexOf('local}') + 5, ': boolean'],
  [destructured.indexOf('ordinary)') + 8, ': number']]);
assert.deepEqual(Object.keys(destructuringHints.paramTypes), ['ordinary'], 'names inside a binding pattern are not simple parameter insertion slots');
assert.equal(destructuringHints.observations.length, 2);
const nested = 'function outer(a = function inner(shadow) { return shadow; }, real) { return real; }';
const nestedHints = parse(nested, ['shadow', 'real'], [[nested.indexOf('shadow)') + 6, ': string'],
  [nested.indexOf('real)') + 4, ': number'], [nested.indexOf(') { return real') + 1, ': boolean']]);
assert.equal(nestedHints.paramTypes.shadow, undefined); assert.equal(nestedHints.paramTypes.real[0].type, 'number');
assert.equal(nestedHints.returnType, 'boolean');
for (const unsupported of [
  'function outer<T extends (shadow: any) => void>(real) { return real; }',
  'function outer(a = /[,)]/, real) { return real; }',
  'function outer(a = [1, 2), real) { return real; }'
]) {
  const hints = parse(unsupported, ['shadow', 'real'], [[unsupported.indexOf('real)') + 4, ': number'],
    [unsupported.indexOf(')') + 1, ': boolean']]);
  assert.equal(hints.hintCount, 0, 'unsupported or unbalanced header syntax cannot own a type slot');
  assert.equal(hints.returnType, undefined); assert.equal(hints.paramTypes, undefined);
  assert.equal(hints.observations.length, 2);
}
const unicode = 'function outer(β, second = ["😀", 1]) { return β; }';
for (const encoding of ['utf-8', 'utf-16', 'utf-32']) {
  const hints = parse(unicode, ['β', 'second'], [[unicode.indexOf('β,') + 1, ': number'],
    [unicode.indexOf(') {') + 1, ': boolean']], encoding);
  assert.equal(hints.paramTypes.β[0].type, 'number'); assert.equal(hints.returnType, 'boolean');
}
const oversized = 'function outer(' + ' '.repeat(16384) + 'real) {}';
assert.equal(parse(oversized, ['real'], [[oversized.indexOf('real)') + 4, ': number']]).hintCount, 0);
assert.equal(createInlayOwnership({ text: source, targetRange: { start: 0, end: Infinity } })(thirdEnd), null);
assert.equal(createInlayOwnership({ text: source, targetRange: { start: 0, end: source.length },
  nameRange: { start: 9, end: 9 } })(thirdEnd), null);
console.log('balanced bounded declaration headers preserve inlay role ownership and open richer refinement');
