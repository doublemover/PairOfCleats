import assert from 'node:assert/strict';
import { canonicalizeTypeText } from '../../src/shared/type-normalization.js';
import { mergeTypeEntries } from '../../src/shared/type-entry-utils.js';
import { normalizeProviderPayload } from '../../src/index/tooling/provider-output-contract.js';

const canonical = (value, languageId = 'python') => canonicalizeTypeText(value, { languageId }).canonicalText;
const pythonCases = new Map([
  ['custom.Optional[str]', 'custom.Optional[str]'],
  ['custom.Union[int, str]', 'custom.Union[int, str]'],
  ['custom.typing.Optional[str]', 'custom.typing.Optional[str]'],
  ['custom.typing_extensions.Union[int, str]', 'custom.typing_extensions.Union[int, str]'],
  ['custom.builtins.str', 'custom.builtins.str'],
  ['custom.string', 'custom.string'],
  ['custom . Optional[typing.Optional[str]]', 'custom.Optional[str | None]'],
  ['builtins.Optional[str]', 'builtins.Optional[str]'],
  ['builtins.Custom', 'builtins.Custom'],
  ['typing.Optional[builtins.str]', 'str | None'],
  ['typing_extensions.Union[builtins.int, builtins.str]', 'int | str'],
  ['typing . Optional[typing . Sequence[builtins . str]]', 'Sequence[str] | None'],
  ['list[typing.Optional[typing.Union[int, str]]]', 'list[int | str | None]'],
  ['Callable[[typing.Optional[int]], typing.Union[str, bytes]]', 'Callable[[int | None], str | bytes]'],
  ['typing.Literal["custom.Optional[str]", "typing.Optional[int]"]', 'Literal["custom.Optional[str]", "typing.Optional[int]"]'],
  ['Δ.Optional[Α]', 'Δ.Optional[Α]'],
  ['__proto__[int]', '__proto__[int]'],
  ['constructor[str]', 'constructor[str]'],
  ['string | integer | boolean', 'str | int | bool']
]);
for (const [input, expected] of pythonCases) {
  assert.equal(canonical(input), expected, input);
  assert.equal(canonical(expected), expected, `${input}: repeated normalization preserves ownership`);
  assert.equal(canonicalizeTypeText(input, { languageId: 'python' }).originalText, input);
}

for (const languageId of ['javascript', 'typescript', 'tsx', 'jsx']) {
  for (const [input, expected] of [
    ['custom.Number', 'custom.Number'], ['custom . Number', 'custom . Number'],
    ['custom.String', 'custom.String'], ['custom.Boolean', 'custom.Boolean'],
    ['custom.integer', 'custom.integer'], ['Number.Member', 'Number.Member'],
    ['Number . Member', 'Number . Member'], ['ΔNumber', 'ΔNumber'],
    ['String世界', 'String世界'], ['Numberπ', 'Numberπ'], ['Boolean\u200cName', 'Boolean\u200cName'],
    ['$String', '$String'], ['_Boolean', '_Boolean'],
    ['Number | String | Boolean | integer | float', 'number | string | boolean | number | number']
  ]) {
    assert.equal(canonical(input, languageId), expected, `${languageId}: ${input}`);
  }
}

// Both the canonical merger and actual provider payload admission must retain
// qualified facts beside supported aliases, regardless of arrival order.
for (const [languageId, types, expected] of [
  ['python', ['custom.Optional[str]', 'typing.Optional[str]'], ['custom.Optional[str]', 'str | None']],
  ['python', ['custom.Union[int, str]', 'typing.Union[int, str]'], ['custom.Union[int, str]', 'int | str']],
  ['typescript', ['custom.Number', 'Number'], ['custom.Number', 'number']]
]) {
  const entries = types.map(type => ({ type, languageId, source: 'annotation', confidence: 0.9 }));
  for (const ordered of [entries, entries.toReversed()]) {
    const merged = mergeTypeEntries([], ordered);
    assert.equal(merged.truncated, false);
    assert.deepEqual(merged.list.map(row => row.type).sort(), expected.toSorted());
    assert.deepEqual(mergeTypeEntries([], merged.list).list.map(row => row.type).sort(), expected.toSorted());
    const observations = [];
    const payload = normalizeProviderPayload({ paramTypes: { value: ordered } }, { observations });
    assert.deepEqual(payload.paramTypes.value.map(row => row.type).sort(), expected.toSorted());
    assert.deepEqual(observations, []);
  }
}

for (const input of [
  'typing.Optional[str', 'typing.Union[int, str]]', 'list[typing.Optional[str)',
  'list['.repeat(129) + 'typing.Optional[str]' + ']'.repeat(129),
  'typing.Optional[' + 'x'.repeat(65537) + ']'
]) {
  assert.equal(canonical(input), input, 'malformed or over-budget structure retains exact input');
}
const boundedNestedUnion = 'typing.Union['.repeat(64) + 'str' + ']'.repeat(64);
assert.equal(canonical(boundedNestedUnion), 'str', 'each nested union is rewritten once');
for (const input of ['\u00000\u0000 | "literal"', 'Literal["literal", \u00000\u0000]', '\u00000\u0000']) {
  assert.equal(canonical(input), input, 'literal placeholders cannot be impersonated by source text');
  assert.equal(canonical(input, 'typescript'), input);
}
console.log('qualified type alias ownership test passed');
