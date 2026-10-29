// UNVALIDATED: actual source parser/comment/type owners; no native execution.
import assert from 'node:assert/strict';
import { extractDocMeta } from '../../../src/lang/javascript/docmeta.js';
import { getLanguageForFile } from '../../../src/index/language-registry.js';
import { getJavaScriptSyntaxIdentity } from '../../../src/lang/javascript/parse.js';
import { buildJsChunks } from '../../../src/lang/javascript/chunks.js';
import { validateMetadataV2Semantics } from '../../../src/contracts/validators/metadata.js';
import { assembleFlowFixture } from '../../helpers/chunk-flow-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('jsdoc-comment-ownership/')[1];
assert.ok(['optional-default', 'nested-records', 'generic-union', 'rest', 'dotted', 'string-template', 'body-comment',
  'unrelated-leading', 'leading-outside', 'malformed', 'empty', 'source-unavailable', 'byte-budget', 'type-depth',
  'babel', 'acorn', 'esprima', 'ast-precedence', 'embedded-offset', 'prototype-key', 'comment-tamper'].includes(selected));
applyTestEnv();
const full = text => ({ start: 0, end: text.length, name: 'f' });
const cases = {
  'optional-default': '/**\n * @param {string} [name="x"]\n */\nfunction f(name) {}',
  'nested-records': '/**\n * @param {{x:number,y:string}} options\n * @returns {{ok:boolean}}\n */\nfunction f(options) {}',
  'generic-union': '/**\n * @param {Array.<(string|number)>} values\n */\nfunction f(values) {}',
  rest: '/**\n * @param {...number} values\n */\nfunction f(...values) {}',
  dotted: '/**\n * @param {Object} options\n * @param {string} options.name\n */\nfunction f(options) {}',
  'string-template': 'function f() { const a = "@param {number} phantom"; const b = `/** @returns {string} */`; }',
  'body-comment': 'function f() { /** @param {number} phantom */ const value = 1; }',
  'unrelated-leading': '/** @param {number} unrelated */\nconst other = 1;\nfunction f(value) {}',
  'leading-outside': '/**\n * @param {string} value\n */\nfunction f(value) {}',
  malformed: '/**\n * @param {{not_closed} value\n */\nfunction f(value) {}',
  empty: '/** A description with no parameter or return tags. */\nfunction f() {}',
  'source-unavailable': '/** @param {string} value */\nfunction f(',
  'byte-budget': `/** ${'x'.repeat(64 * 1024)} */\nfunction f() {}`,
  'type-depth': `/** @param {${'Array.<'.repeat(65)}string${'>'.repeat(65)}} values */\nfunction f(values) {}`,
  'prototype-key': '/** @param {string} __proto__ */\nfunction f(__proto__) {}'
};
if (Object.hasOwn(cases, selected)) {
  const text = cases[selected], chunk = full(text);
  if (['leading-outside', 'unrelated-leading'].includes(selected)) chunk.start = text.indexOf('function f');
  const meta = extractDocMeta(text, chunk);
  if (selected === 'optional-default') {
    assert.deepEqual(meta.params, ['name']); assert.equal(meta.paramTypes.name, 'string');
    assert.ok(Object.isFrozen(meta.documentation.parameters)); assert.ok(Object.isFrozen(meta.documentation.parameters[0]));
    assert.equal(meta.documentation.parameters[0].optional, true);
    assert.equal(meta.documentation.parameters[0].default, '"x"');
  } else if (selected === 'nested-records') {
    assert.deepEqual(meta.params, ['options']); assert.equal(meta.paramTypes.options, '{x:number,y:string}');
    assert.equal(meta.returnType, '{ok:boolean}'); assert.equal(meta.returns, true);
  } else if (selected === 'generic-union') {
    assert.equal(meta.paramTypes.values, 'Array.<(string|number)>', 'preserve the validated original dialect text');
  } else if (selected === 'rest') {
    assert.equal(meta.documentation.parameters[0].rest, true); assert.equal(meta.paramTypes.values, '...number');
  } else if (selected === 'dotted') {
    assert.deepEqual(meta.params, ['options', 'options.name']); assert.equal(meta.paramTypes['options.name'], 'string');
  } else if (selected === 'prototype-key') {
    assert.deepEqual(meta.params, ['__proto__']); assert.equal(Object.hasOwn(meta.paramTypes, '__proto__'), true);
    assert.equal(meta.paramTypes.__proto__, 'string'); assert.equal(Object.getPrototypeOf(meta.paramTypes), Object.prototype);
  } else if (selected === 'leading-outside') {
    assert.deepEqual(meta.params, ['value']); assert.equal(meta.paramTypes.value, 'string');
    assert.ok(meta.documentation.range.end < chunk.start, 'the associated leading comment is outside the function slice');
  } else if (['malformed', 'type-depth'].includes(selected)) {
    assert.equal(meta.documentation.state, 'malformed'); assert.deepEqual(meta.params, []); assert.deepEqual(meta.paramTypes, {});
    assert.ok(meta.documentation.problems.length);
  } else if (selected === 'empty') {
    assert.equal(meta.documentation.state, 'parsed'); assert.deepEqual(meta.params, []); assert.equal(meta.returns, false);
  } else if (['source-unavailable', 'byte-budget'].includes(selected)) {
    assert.equal(meta.documentation.state, 'unavailable'); assert.deepEqual(meta.params, []);
    if (selected === 'byte-budget') {
      assert.deepEqual(meta.documentation.range, { start: 0, end: text.indexOf('*/') + 2 });
      assert.deepEqual(meta.documentation.problems, ['doc-comment-byte-budget']);
    }
  } else {
    assert.equal(meta.documentation.state, 'absent'); assert.deepEqual(meta.params, []);
    assert.deepEqual(meta.paramTypes, {}); assert.equal(meta.returns, false); assert.equal(meta.returnType, null);
  }
} else {
  const parser = ['babel', 'acorn', 'esprima'].includes(selected) ? selected : 'babel';
  const text = selected === 'comment-tamper'
    ? 'function f(value) { const source = "/** @param {number} phantom */"; return value; }'
    : '/**\n * @param {{x:number}} value\n * @returns {{ok:boolean}}\n */\nfunction f(value) { return {ok: true}; }';
  const options = { javascript: { parser }, treeSitter: { enabled: false }, astDataflowEnabled: false, controlFlowEnabled: false };
  const lang = getLanguageForFile('.js', 'fixture.js');
  const context = await lang.prepare({ text, ext: '.js', relPath: 'fixture.js', mode: 'code', options });
  assert.equal(getJavaScriptSyntaxIdentity(context.jsAst).family, parser, 'fallback cannot qualify another parser');
  if (selected === 'comment-tamper') {
    const start = text.indexOf('/**'), end = text.indexOf('*/', start) + 2;
    context.jsAst.comments.push({ type: 'CommentBlock', start, end, value: text.slice(start + 2, end - 2) });
    assert.equal(context.jsAst.comments.length, 1, 'the public AST was actually modified after parser admission');
  }
  const relations = lang.buildRelations({ text, ext: '.js', relPath: 'fixture.js', context, options });
  const chunk = buildJsChunks(text, { ...options, ast: context.jsAst }).find(value => value.name === 'f');
  assert.ok(chunk);
  if (selected !== 'comment-tamper') assert.ok(chunk.start > 0, 'integration uses the actual function chunk without its leading docs');
  if (selected === 'ast-precedence') {
    const record = Object.values(relations.jsDeclarations.records).find(value => value.displayName === 'f');
    record.metadata.params = []; record.metadata.paramNames = []; record.metadata.returnType = 'boolean';
    record.metadata.paramTypes = { value: 'ActualSyntaxType' };
  }
  const offset = selected === 'embedded-offset' ? 17 : 0;
  const sourceView = offset ? { text: 'x'.repeat(offset) + text, offset,
    chunk: { ...chunk, start: chunk.start + offset, end: chunk.end + offset } } : null;
  const meta = lang.extractDocMeta({ text, chunk, fileRelations: relations, context, sourceView });
  assert.equal(meta.documentation.authority, 'documentation');
  if (selected === 'comment-tamper') {
    assert.equal(meta.documentation.state, 'absent'); assert.equal(meta.doc, ''); assert.deepEqual(meta.paramTypes, {});
    assert.deepEqual(meta.params, ['value'], 'real syntax parameters survive refusal of invented documentation');
  } else if (selected === 'ast-precedence') {
    assert.equal(meta.documentation.state, 'parsed'); assert.equal(meta.documentation.range.start, offset);
    assert.deepEqual(meta.params, []); assert.deepEqual(meta.paramNames, []);
    assert.equal(meta.returnType, 'boolean'); assert.equal(meta.paramTypes.value, 'ActualSyntaxType');
    assert.equal(meta.documentation.returnType, '{ok:boolean}', 'documentation remains a distinct hint, never fabricated syntax');
  } else {
    assert.equal(meta.documentation.state, 'parsed'); assert.equal(meta.documentation.range.start, offset);
    assert.deepEqual(meta.params, ['value']); assert.equal(meta.paramTypes.value, '{x:number}'); assert.equal(meta.returnType, '{ok:boolean}');
    assert.ok(meta.signature.includes('f('));
    if (!offset) {
      const assembled = assembleFlowFixture({ text, chunk, docmeta: meta, lang: 'javascript', ext: '.js', codeRelations: {} });
      assert.deepEqual(validateMetadataV2Semantics(assembled.metaV2), []);
      assert.equal(assembled.docmeta.documentation.state, 'parsed');
    }
  }
}
console.log(`JavaScript documentation ${selected}: parser-associated hints and explicit syntax authority, qualification deferred.`);
