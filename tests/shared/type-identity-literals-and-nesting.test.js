import assert from 'node:assert/strict';
import { canonicalizeTypeText } from '../../src/shared/type-normalization.js';
import { mergeTypeEntries } from '../../src/shared/type-entry-utils.js';

for (const [left, right] of [['User', 'user'], ['"OK"', '"ok"'], ['"a b"', '"a  b"'],
  ['"a | b"', '"a|b"'], ['`A ${T}`', '`a ${T}`']]) {
  const rows = [left, right].map(type => ({ type, source: 'annotation', confidence: 0.95, languageId: 'typescript' }));
  assert.equal(mergeTypeEntries([], rows).list.length, 2, `${left} and ${right} retain distinct identities`);
  assert.equal(mergeTypeEntries([], rows.toReversed()).list.length, 2);
}
assert.equal(mergeTypeEntries([], ['Map < User , "a  | b" >', 'Map<User,"a  | b">']).list.length, 1);
const original = '  Map < User, "a  | b" >  ';
const once = mergeTypeEntries([], [{ type: original, source: 'annotation' }]).list;
assert.equal(once[0].originalText, original);
assert.equal(mergeTypeEntries([], once).list[0].originalText, original);
const python = value => canonicalizeTypeText(value, { languageId: 'python' }).canonicalText;
assert.equal(python('list[Optional[str]]'), 'list[str | None]');
assert.equal(python('Optional[list[str]]'), 'list[str] | None');
assert.equal(python('dict[str, Optional[int]]'), 'dict[str, int | None]');
assert.equal(python('typing.Union[int, str]'), 'int | str');
assert.equal(python('list[Union[int, str]]'), 'list[int | str]');
assert.equal(python('Optional[Union[int, str]]'), 'int | str | None');
assert.equal(python('Literal["Optional[str]", "a  b"]'), 'Literal["Optional[str]", "a  b"]');
assert.equal(python('typing.Optional[str'), 'typing.Optional[str', 'malformed syntax is preserved');
console.log('type identity literals and nesting test passed');
