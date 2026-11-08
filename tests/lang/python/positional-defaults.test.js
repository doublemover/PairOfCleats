import assert from 'node:assert/strict';
import { buildLanguageContext } from '../../../src/index/language-registry.js';
import { shutdownPythonAstPool } from '../../../src/lang/python.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const cases = [
  ['spanning', 'def spanning(a=1, /, b=2): pass', 'def spanning(a=1, /, b=2)', { a: '1', b: '2' }],
  ['only', 'def only(a=1, /): pass', 'def only(a=1, /)', { a: '1' }],
  ['control', 'def control(a, /, b=2): pass', 'def control(a, /, b=2)', { b: '2' }],
  ['keyword', 'def keyword(a=1, /, b=2, *args, required, optional=None, **kwargs): pass',
    'def keyword(a=1, /, b=2, *args, required, optional=None, **kwargs)', { a: '1', b: '2', optional: 'None' }],
  ['async_spanning', 'async def async_spanning(a=1, /, b=2, *, flag=False): return a + b',
    'def async_spanning(a=1, /, b=2, *, flag=False)', { a: '1', b: '2', flag: 'False' }]
];
try {
  const text = cases.map(entry => entry[1]).join('\n');
  const { lang, context } = await buildLanguageContext({ ext: '.py', relPath: 'package/defaults.py', mode: 'code', text,
    options: { pythonAst: { enabled: true, workerCount: 1, maxWorkers: 1, maxRetries: 0, taskTimeoutMs: 5000 } } });
  assert.ok(context.pythonAst, 'the actual Python worker produces signatures/default metadata');
  for (const [name, , signature, defaults] of cases) {
    const definition = context.pythonAst.defs.find(entry => entry.name === name);
    assert.equal(definition.signature, signature);
    assert.deepEqual(definition.paramDefaults, defaults);
    const chunk = context.pythonChunks.find(entry => entry.name === name);
    assert.deepEqual(chunk.meta.paramDefaults, defaults);
    assert.equal(chunk.meta.signature, signature);
    const docmeta = lang.extractDocMeta({ chunk, context, fileRelations: null });
    assert.equal(docmeta.signature, signature);
    assert.deepEqual(docmeta.paramDefaults, defaults);
  }
  assert.equal(context.pythonChunks.find(entry => entry.name === 'async_spanning').meta.async, true);
  assert.deepEqual(context.pythonChunks.find(entry => entry.name === 'keyword').meta.params,
    ['a', 'b', 'args', 'required', 'optional', 'kwargs']);
} finally { await shutdownPythonAstPool(); }
console.log('Python positional-only and regular defaults align across the slash through AST, chunks and docmeta, preserving keyword/varargs/async controls.');
