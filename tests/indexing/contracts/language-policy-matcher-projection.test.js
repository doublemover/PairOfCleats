import assert from 'node:assert/strict';
import { buildLanguagePolicyKey } from '../../../src/contracts/compatibility.js';
import { normalizeCommentConfig } from '../../../src/index/comments.js';
import { createSafeRegex } from '../../../src/shared/safe-regex.js';

const commentsConfig = normalizeCommentConfig();
const runtime = { commentsConfig, languageOptions: { nested: { setting: 1, rootDir: '/first' } } };
const before = buildLanguagePolicyKey(runtime);
for (const key of ['licensePattern', 'generatedPattern', 'linterPattern']) {
  commentsConfig[key].test('copyright generated eslint');
}
assert.equal(buildLanguagePolicyKey(runtime), before, 'matcher execution must not alter policy identity');
assert.equal(buildLanguagePolicyKey({ ...runtime, commentsConfig: normalizeCommentConfig() }), before,
  'repeated builds must accept reused default matcher instances');
assert.equal(buildLanguagePolicyKey({ ...runtime, languageOptions: { nested: { setting: 1, rootDir: '/second' } } }), before);
assert.notEqual(buildLanguagePolicyKey({ ...runtime, languageOptions: { nested: { setting: 2 } } }), before,
  'nonvolatile nested configuration must remain significant');
for (const key of ['licensePattern', 'generatedPattern', 'linterPattern']) {
  assert.notEqual(buildLanguagePolicyKey({ ...runtime, commentsConfig: normalizeCommentConfig({ [key]: 'different' }) }), before,
    `${key} source must remain significant`);
}
const regexKey = (pattern) => buildLanguagePolicyKey({ languageOptions: { pattern } });
assert.notEqual(regexKey(/first/i), regexKey(/second/i), 'native regex sources must not collapse to empty objects');
assert.notEqual(regexKey(/first/i), regexKey(/first/g), 'native regex flags are semantic');
const native = /first/g;
const nativeBefore = regexKey(native);
native.test('first');
assert.equal(regexKey(native), nativeBefore, 'native regex cursor is transient');
const safe = createSafeRegex('first', 'g', { maxInputLength: 50 });
const safeBefore = regexKey(safe);
safe.test('first');
assert.equal(regexKey(safe), safeBefore);
assert.notEqual(regexKey(createSafeRegex('first', 'i', { maxInputLength: 50 })), safeBefore);
assert.notEqual(regexKey(createSafeRegex('first', 'g', { maxInputLength: 51 })), safeBefore,
  'safe-regex limits affect semantics and must remain significant');
assert.notEqual(regexKey({ compiled: 'user-config-a' }), regexKey({ compiled: 'user-config-b' }),
  'ordinary config keys named compiled must not be globally dropped');
console.log('language policy matcher projection test passed');
