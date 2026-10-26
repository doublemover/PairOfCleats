import assert from 'node:assert/strict';
import { buildRubyChunks, buildRubyRelations } from '../../../src/lang/ruby.js';
import { rubyCallableBodyRange } from '../../../src/lang/ruby/body-boundary.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const cases = [
  ['def idle(); end', []],
  ['def idle\nend', []],
  ['def recursive(value); recursive(value); end', ['recursive']],
  ['def same(value = default_call()); body_call(); end', ['body_call']],
  ['def same(\n value = default_call(),\n other = "quoted);"\n)\n body_call()\nend', ['body_call']],
  ['def same value = default_call(),\n other = seed()\n body_call()\nend', ['body_call']],
  ['def same(value = "line\n); # fake()") # header_comment()\n body_call()\nend', ['body_call']],
  ['def endless = body_call()', ['body_call']],
  ['def setter=(value); body_call(); end', ['body_call']],
  ['def self.singleton(value); body_call(); end', ['body_call']],
  ['def uncertain(value = /closing) fake()/)\n body_call()\nend', []],
  ['def uncertain(value = %q(fake()))\n body_call()\nend', []],
  ['def uncertain(\n default_call()', []],
  ['def uncertain(' + ' '.repeat(65536) + 'default_call())\n body_call()\nend', []]
];
for (const [text, expected] of cases) {
  const chunk = { start: 0, end: text.length, name: 'fixture', kind: 'MethodDeclaration', meta: {} };
  const relations = buildRubyRelations(text, [chunk]);
  assert.deepEqual(relations.calls.map(([, name]) => name).sort(), expected, text.slice(0, 100));
  assert.equal(relations.callCoverage, 'partial-heuristic-callable-bodies');
}
const source = 'def actual(value = header_call())\n body_call()\nend\n';
const chunks = buildRubyChunks(source, { treeSitter: { enabled: false } });
assert.ok(chunks?.length, 'the actual legacy chunk producer remains usable');
assert.deepEqual(buildRubyRelations(source, chunks).calls, [['actual', 'body_call']]);
const owned = 'def same(value = header_call()); body_call(); end';
const start = owned.indexOf('body_call');
const chunk = { start: 0, end: owned.length, name: 'same', kind: 'MethodDeclaration',
  meta: { bodyStart: start, bodyEnd: start + 'body_call()'.length } };
assert.deepEqual(rubyCallableBodyRange(owned, chunk), { start, end: chunk.meta.bodyEnd });
assert.deepEqual(buildRubyRelations(owned, [chunk]).calls, [['same', 'body_call']], 'copied body bounds have priority');
assert.deepEqual(buildRubyRelations(owned, [{ ...chunk, meta: { ...chunk.meta, bodyless: true } }]).calls, []);
assert.equal(rubyCallableBodyRange(source, { start: 0, end: source.length, meta: { bodyStart: -1, bodyEnd: 99999 } }).start,
  source.indexOf(' body_call'), 'invalid copied bounds do not become authority');
console.log('Ruby fallback call extraction stays inside bounded callable bodies');
