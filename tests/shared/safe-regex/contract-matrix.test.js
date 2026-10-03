#!/usr/bin/env node
import assert from 'node:assert/strict';

import { tryRequire } from '../../../src/shared/optional-deps.js';
import { compileSafeRegex, createSafeRegex, normalizeSafeRegexConfig } from '../../../src/shared/safe-regex.js';

const hasRe2 = tryRequire('re2').ok;

{
  const autoRegex = createSafeRegex('a', 'g');
  assert(autoRegex);
  assert.equal(autoRegex.engine, hasRe2 ? 're2' : 're2js');

  const forcedJs = createSafeRegex('a', 'g', { engine: 're2js' });
  assert(forcedJs);
  assert.equal(forcedJs.engine, 're2js');

  const forcedRe2 = createSafeRegex('a', 'g', { engine: 're2' });
  assert(forcedRe2);
  assert.equal(forcedRe2.engine, hasRe2 ? 're2' : 're2js');

  const matchRegex = createSafeRegex('(a)(b)', 'g');
  const match1 = matchRegex.exec('ab');
  assert(match1);
  assert.equal(match1[0], 'ab');
  assert.equal(match1[1], 'a');
  assert.equal(match1[2], 'b');
  assert.equal(match1.index, 0);
  assert.equal(matchRegex.lastIndex, 2);
  assert.equal(matchRegex.exec('ab'), null);
  assert.equal(matchRegex.lastIndex, 0);

  const testRegex = createSafeRegex('a', 'g');
  assert.equal(testRegex.test('a'), true);
  assert.equal(testRegex.lastIndex, 1);
  assert.equal(testRegex.test('a'), false);
  assert.equal(testRegex.lastIndex, 0);

  const limitedInput = createSafeRegex('a', '', { maxInputLength: 1 });
  assert(limitedInput);
  assert.equal(limitedInput.exec('aa'), null);
  assert.equal(limitedInput.lastIndex, 0);

  assert.equal(createSafeRegex('aa', '', { maxPatternLength: 1 }), null);
  assert.equal(createSafeRegex('a', '', { maxProgramSize: 1 }), null);
  assert.equal(createSafeRegex('(', '', {}), null);
}

{
  const normalized = normalizeSafeRegexConfig({ flags: 'usmgii' });
  assert.equal(normalized.flags, 'gims');
  const regex = createSafeRegex('a', 'smgi', { flags: 'i' });
  assert(regex);
  assert.equal(regex.flags, 'gims');
}

{
  const { regex } = compileSafeRegex('a', 'g', { maxInputLength: 1 });
  assert(regex);
  assert.equal(regex.test('aa'), false);
  assert.equal(regex.lastIndex, 0);

  const result = compileSafeRegex('a', '', { maxProgramSize: 1 });
  assert.equal(result.regex, null);
  assert.equal(result.error?.code, 'PROGRAM_TOO_LARGE');
}

console.log('shared safe-regex contract matrix test passed');
