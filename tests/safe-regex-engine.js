import assert from 'node:assert/strict';
import { createSafeRegex, isNativeRe2Available } from '../src/shared/safe-regex.js';

const basic = createSafeRegex('foo(\\d+)', '', { engine: 're2js' });
assert.ok(basic, 'expected basic safe regex to compile');
const match = basic.exec('xxfoo123yy');
assert.ok(match, 'expected match');
assert.equal(match[0], 'foo123');
assert.equal(match[1], '123');
assert.equal(match.index, 2);
assert.equal(match.input, 'xxfoo123yy');

const g = createSafeRegex('a', 'g', { engine: 're2js' });
assert.ok(g, 'expected global regex to compile');
const m1 = g.exec('a a');
assert.ok(m1);
assert.equal(m1.index, 0);
assert.equal(g.lastIndex, 1);

const m2 = g.exec('a a');
assert.ok(m2);
assert.equal(m2.index, 2);
assert.equal(g.lastIndex, 3);

const m3 = g.exec('a a');
assert.equal(m3, null);
assert.equal(g.lastIndex, 0, 'expected lastIndex reset after global miss');

const t = createSafeRegex('a', 'g', { engine: 're2js' });
assert.ok(t);
assert.equal(t.test('a a'), true);
assert.equal(t.lastIndex, 1);
assert.equal(t.test('a a'), true);
assert.equal(t.lastIndex, 3);
assert.equal(t.test('a a'), false);
assert.equal(t.lastIndex, 0);

const sticky = createSafeRegex('a', 'y', { engine: 're2js' });
assert.ok(sticky);
sticky.lastIndex = 1;
const sm1 = sticky.exec('ba');
assert.ok(sm1);
assert.equal(sm1.index, 1);
assert.equal(sticky.lastIndex, 2);
const sm2 = sticky.exec('ba');
assert.equal(sm2, null);
assert.equal(sticky.lastIndex, 0, 'expected lastIndex reset after sticky miss');

const tooLongPattern = createSafeRegex('a'.repeat(20), '', { maxPatternLength: 5, engine: 're2js' });
assert.equal(tooLongPattern, null, 'expected maxPatternLength to reject pattern');

const inputLimit = createSafeRegex('a', 'g', { maxInputLength: 2, engine: 're2js' });
assert.ok(inputLimit);
assert.equal(inputLimit.exec('aaa'), null);
assert.equal(inputLimit.lastIndex, 0);

const flagNorm = createSafeRegex('a', 'g', { flags: 'imzzz', engine: 're2js' });
assert.ok(flagNorm);
assert.ok(flagNorm.flags.includes('i'));
assert.ok(flagNorm.flags.includes('m'));
assert.ok(!flagNorm.flags.includes('z'));

const forcedRe2js = createSafeRegex('a', '', { engine: 're2js' });
assert.ok(forcedRe2js);
assert.equal(forcedRe2js.engine, 're2js');

const auto = createSafeRegex('a', '', { engine: 'auto' });
assert.ok(auto);
assert.ok(['re2', 're2js'].includes(auto.engine));

const nativeAvailable = isNativeRe2Available();
let sawWarn = false;
const originalWarn = console.warn;
console.warn = () => {
  sawWarn = true;
};
const forcedRe2 = createSafeRegex('a', '', { engine: 're2' });
console.warn = originalWarn;
assert.ok(forcedRe2);
if (nativeAvailable) {
  assert.equal(forcedRe2.engine, 're2');
  assert.equal(sawWarn, false);
} else {
  assert.equal(forcedRe2.engine, 're2js');
  assert.equal(sawWarn, true);
}

console.log('safe regex engine test passed');
