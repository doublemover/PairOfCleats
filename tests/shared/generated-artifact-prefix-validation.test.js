#!/usr/bin/env node
import assert from 'node:assert/strict';
import { hasAmbiguousGeneratedArtifactPrefix } from '../../src/shared/generated-artifact-prefix.js';
import { withGeneratedArtifactMetadata, classifyGeneratedArtifactCorePrefix } from '../../src/shared/generated-artifact-core.js';
import { withGeneratedCacheMetadata, classifyGeneratedArtifactCachePrefix } from '../../src/shared/generated-artifact-cache.js';

const completeJsonObject = (text) => {
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  } catch { return false; }
};
const validDocuments = [
  {}, { string: 'quote " backslash \\ line\n tab\t 漢字💡' },
  { values: [null, true, false, -0, 12.5, 1e30, -2e-10], nested: { array: [{ key: 'value' }, []] } },
  { escaped: '\u0041', control: '\u0000', empty: '' }
].map(JSON.stringify);
validDocuments.push('{"escaped\\u0061":"\\u0041\\n\\\\\\\"","number":-1.25e+12}');
validDocuments.push('{"negativeZero":-0,"fraction":0.1,"exponent":1E-4}');
for (let seed = 0; seed < 64; seed += 1) {
  validDocuments.push(JSON.stringify({
    [`key-${seed}`]: Array.from({ length: seed % 7 }, (_, index) => ({
      value: (seed + 1) * (index % 2 ? -0.125 : 1e8),
      text: `${seed}:${index} 漢字💡\n"\\`, flag: index % 2 === 0
    })),
    nested: { optional: null, count: seed }
  }));
}
for (const text of validDocuments) {
  assert.equal(completeJsonObject(text), true);
  assert.equal(hasAmbiguousGeneratedArtifactPrefix(text, true), false, text);
  for (let cut = 1; cut < text.length; cut += 1) {
    const prefix = text.slice(0, cut);
    assert.equal(hasAmbiguousGeneratedArtifactPrefix(prefix, false), false, `valid cut ${cut}: ${prefix}`);
    assert.equal(!hasAmbiguousGeneratedArtifactPrefix(prefix, true), completeJsonObject(prefix),
      'short complete inputs must agree with JSON.parse');
  }
}

const invalidDocuments = [
  '{oops}', '{"x":oops}', '{"x":01}', '{"x":1.}', '{"x":1.e2}', '{"x":+1}',
  '{"x":true false}', '{"x":tru}', '{"x":nul}', '{"x":falsee}', '{"x":-01}',
  '{"x":[1,,2]}', '{"x":[1,]}', '{"x":1,}', '{"x" 1}',
  '{"x":"bad\\q"}', '{"x":"bad\\u00G0"}', '{"x":"line\nbreak"}',
  '{"x":"control' + String.fromCharCode(0) + '"}', '{/*comment*/"x":1}', '{}{}'
];
for (const text of invalidDocuments) {
  assert.equal(completeJsonObject(text), false, text);
  assert.equal(hasAmbiguousGeneratedArtifactPrefix(text, true), true, text);
  assert.equal(hasAmbiguousGeneratedArtifactPrefix(text + ' '.repeat(100), false), true, text);
}
for (const text of ['{"x":1,"x":2}', '{"x":1,"\\u0078":2}']) {
  assert.equal(completeJsonObject(text), true, 'JSON.parse alone does not reject duplicate keys');
  assert.equal(hasAmbiguousGeneratedArtifactPrefix(text, true), true);
}
assert.equal(hasAmbiguousGeneratedArtifactPrefix('{"nested":' + '['.repeat(300), false), true,
  'excessive grammar depth fails open without recursive parsing');
assert.equal(hasAmbiguousGeneratedArtifactPrefix('{"nested":' + '['.repeat(255) + '0' + ']'.repeat(255) + '}', true), false,
  '256 containers remain within the explicit depth budget');
assert.equal(hasAmbiguousGeneratedArtifactPrefix('{"nested":' + '['.repeat(256) + '0' + ']'.repeat(256) + '}', true), true,
  '257 containers exceed the explicit depth budget');
assert.equal(hasAmbiguousGeneratedArtifactPrefix(' \t\n{"x":1}\r ', true), false);
assert.equal(hasAmbiguousGeneratedArtifactPrefix('\u00a0{"x":1}', true), true, 'non-JSON whitespace is invalid');

const classifiers = [
  {
    make: (fields) => withGeneratedArtifactMetadata(fields, 'index-state'),
    classify: classifyGeneratedArtifactCorePrefix, relativePath: 'index_state.json', kind: 'index-state'
  },
  {
    make: (fields) => withGeneratedCacheMetadata(fields, 'lsp-requests'),
    classify: classifyGeneratedArtifactCachePrefix, relativePath: 'lsp/request-cache-v1.json', kind: 'object-cache'
  }
];
const tails = [
  ['"hello', '"}'], ['"hello\\', 'n"}'], ['"hello\\u', '0041"}'],
  ['"hello\\u0', '041"}'], ['"hello\\u00', '41"}'], ['"hello\\u004', '1"}'],
  ['-', '1}'], ['1.', '25}'], ['1e', '+2}'], ['1e-', '2}'], ['0', '}'],
  ['tru', 'e}'], ['fals', 'e}'], ['nul', 'l}'],
  ['[true,', 'false]}'], ['{"nested":', 'null}}'], ['{"nest', 'ed":1}}'], ['{"k\\u0', '061":1}}']
];
for (const { make, classify, relativePath, kind } of classifiers) {
  const start = JSON.stringify(make({ payload: null })).slice(0, -5);
  const atBoundary = (tail, continuation) => start
    + ' '.repeat(8192 - Buffer.byteLength(start + tail, 'utf8')) + tail + continuation;
  for (const [tail, continuation] of tails) {
    const text = atBoundary(tail, continuation);
    assert.equal(completeJsonObject(text), true, `fixture ${tail}`);
    const prefix = Buffer.from(text).subarray(0, 8192);
    assert.equal(prefix.length, 8192);
    assert.equal(classify({ prefix, relativePath })?.kind, kind, `valid cap tail ${tail}`);
    assert.equal(classify({ prefix })?.kind, kind, 'content-only path has the same validation');
  }
  for (const cutBytes of [1, 2, 3]) {
    const before = start + '"漢字é';
    const text = before + 'a'.repeat(8192 - Buffer.byteLength(before, 'utf8') - cutBytes) + '💡tail"}';
    assert.equal(completeJsonObject(text), true);
    const prefix = Buffer.from(text).subarray(0, 8192);
    assert.ok(prefix.toString('utf8').length < prefix.length, 'byte and string offsets intentionally differ');
    assert.equal(classify({ prefix, relativePath })?.kind, kind, `UTF-8 character cut after ${cutBytes} byte(s)`);
  }
  for (const bad of ['oops', '[1,,2]', '[1,]', '{"a":1,}', '{"a" 1}', '{"a":1,"\\u0061":2}', '/*comment*/0']) {
    const prefix = Buffer.from(start + bad + ' '.repeat(9000)).subarray(0, 8192);
    assert.equal(classify({ prefix, relativePath }), null, `visible syntax error: ${bad}`);
    assert.equal(classify({ prefix }), null);
  }
  for (const bad of ['"é\\q', '"é\\u00G0', '"é\n', '"é' + String.fromCharCode(1)]) {
    const prefix = Buffer.from(start + bad + 'a'.repeat(9000)).subarray(0, 8192);
    assert.equal(classify({ prefix, relativePath }), null, 'later string truncation cannot hide earlier lexical errors');
  }
  for (const bad of ['"valid\\q', '"valid\\u12G', '{"a":1,tru', '01', '1.e', '+', '--']) {
    const prefix = Buffer.from(atBoundary(bad, 'padding')).subarray(0, 8192);
    assert.equal(classify({ prefix, relativePath }), null, `invalid boundary token: ${bad}`);
  }
}
console.log('generated prefixes reject visible syntax errors and allow only genuine bounded JSON truncation');
