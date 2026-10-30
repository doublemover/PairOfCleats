import assert from 'node:assert/strict';
import { buildLanguageContext, buildChunkRelations } from '../../../src/index/language-registry.js';
import { buildPythonChunksFromAst } from '../../../src/lang/python/chunks-from-ast.js';
import { shutdownPythonAstPool } from '../../../src/lang/python.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const text = [
  'def previous():',
  '    return "unrelated"',
  '',
  '@(route("/first-😀"))',
  'def same_line():',
  '    return "one"',
  '',
  '@(',
  '    route("/multiline-only")',
  ')',
  '# attached comment',
  '@(other)',
  'async def multiline():',
  '    return "two"',
  '',
  'class Container:',
  '    @(',
  '        nested("/nested-only")',
  '    )',
  '    class Local:',
  '        pass',
  '    @ (decorator)',
  '    def method(self):',
  '        return real_body()',
  ''
].join('\r\n');
try {
  const { lang, context } = await buildLanguageContext({ text, ext: '.py', relPath: 'prefixes.py', mode: 'code',
    options: { astDataflowEnabled: true, controlFlowEnabled: true,
      pythonAst: { enabled: true, workerCount: 1, maxWorkers: 1, maxRetries: 0, taskTimeoutMs: 5000 } } });
  assert.ok(context.pythonAst && !context.pythonAst.error, 'real CPython parses parenthesized decorator syntax');
  for (const [name, start, definition] of [
    ['same_line', '@(route', 'def same_line'],
    ['multiline', '@(\r\n', 'async def multiline'],
    ['Container.Local', '@(\r\n        nested', 'class Local'],
    ['Container.method', '@ (decorator)', 'def method']
  ]) {
    const chunk = context.pythonChunks.find(entry => entry.name === name);
    assert.ok(chunk, name);
    const startOffset = text.indexOf(start);
    assert.equal(chunk.start, startOffset, `${name}: complete decorator token starts source coverage`);
    assert.equal(chunk.meta.startLine, text.slice(0, startOffset).split('\r\n').length);
    assert.equal(chunk.meta.definitionStartLine, text.slice(0, text.indexOf(definition)).split('\r\n').length);
    assert.equal(chunk.meta.sourceCoverageReason, undefined);
    const codeText = text.slice(chunk.start, chunk.end);
    assert.ok(codeText.startsWith('@'));
    if (name === 'same_line') assert.ok(codeText.includes('/first-😀'));
    if (name === 'multiline') assert.ok(codeText.includes('/multiline-only') && codeText.includes('@(other)'));
    if (name === 'Container.Local') assert.ok(codeText.includes('/nested-only'));
    assert.ok(!codeText.includes('return "unrelated"'), 'prefix association does not absorb an earlier statement');
  }
  const relations = lang.buildRelations({ text, context, options: {} });
  const method = context.pythonChunks.find(entry => entry.name === 'Container.method');
  assert.deepEqual(buildChunkRelations({ lang, chunk: method, fileRelations: relations }).calls,
    [['Container.method', 'real_body']], 'full prefix coverage does not reassign decorator observations to method execution');
  const source = '@(route)\ndef missing():\n    pass\n';
  const unqualified = buildPythonChunksFromAst(source, { defs: [{ name: 'missing', kind: 'FunctionDeclaration',
    startLine: 2, startCol: 0, endLine: 3, endCol: 8, sourceCoverageReason: 'python_decorator_prefix_unavailable' }] });
  assert.equal(unqualified[0].start, source.indexOf('def missing'));
  assert.equal(unqualified[0].meta.sourceCoverage, 'partial', 'an unavailable token proof never falls back to guessed prefix subtraction');
  console.log('CPython parenthesized decorator source coverage and registered ownership test passed');
} finally {
  await shutdownPythonAstPool();
}
