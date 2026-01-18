#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSafeRegex } from '../src/shared/safe-regex.js';
import { tryRequire } from '../src/shared/optional-deps.js';

const hasRe2 = tryRequire('re2').ok;

const autoRegex = createSafeRegex('a', 'g');
assert(autoRegex, 'auto regex should compile');
assert.equal(autoRegex.engine, hasRe2 ? 're2' : 're2js', 'auto engine should match availability');

const forcedJs = createSafeRegex('a', 'g', { engine: 're2js' });
assert(forcedJs, 'forced re2js should compile');
assert.equal(forcedJs.engine, 're2js', 'forced re2js should use re2js');

const forcedRe2 = createSafeRegex('a', 'g', { engine: 're2' });
assert(forcedRe2, 'forced re2 should compile or fall back');
assert.equal(forcedRe2.engine, hasRe2 ? 're2' : 're2js', 'forced re2 should fall back when missing');

const matchRegex = createSafeRegex('(a)(b)', 'g');
const match1 = matchRegex.exec('ab');
assert(match1, 'exec should return match');
assert.equal(match1[0], 'ab');
assert.equal(match1[1], 'a');
assert.equal(match1[2], 'b');
assert.equal(match1.index, 0);
assert.equal(matchRegex.lastIndex, 2);
const match2 = matchRegex.exec('ab');
assert.equal(match2, null);
assert.equal(matchRegex.lastIndex, 0);

const testRegex = createSafeRegex('a', 'g');
assert.equal(testRegex.test('a'), true);
assert.equal(testRegex.lastIndex, 1);
assert.equal(testRegex.test('a'), false);
assert.equal(testRegex.lastIndex, 0);

const limitedInput = createSafeRegex('a', '', { maxInputLength: 1 });
assert(limitedInput, 'input-limited regex should compile');
assert.equal(limitedInput.exec('aa'), null);
assert.equal(limitedInput.lastIndex, 0);

const limitedPattern = createSafeRegex('aa', '', { maxPatternLength: 1 });
assert.equal(limitedPattern, null, 'pattern length limit should reject');

const limitedProgram = createSafeRegex('a', '', { maxProgramSize: 1 });
assert.equal(limitedProgram, null, 'program size limit should reject');

const invalidPattern = createSafeRegex('(', '', {});
assert.equal(invalidPattern, null, 'invalid patterns should be rejected');

console.log('safe regex engine tests passed');
