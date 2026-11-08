import assert from 'node:assert/strict';
import { buildLanguageContext, buildChunkRelations } from '../../../src/index/language-registry.js';
import { buildCallIndex } from '../../../src/index/build/file-processor/relations.js';
import { shutdownPythonAstPool } from '../../../src/lang/python.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const text = [
  '@module_decorator(module_argument())',
  'def factory(value=module_default()):',
  '    @function_decorator(decorator_argument())',
  '    def nested(value: argument_type() = seed(), *, keyword=keyword_seed()) -> result_type():',
  '        return function_body()',
  '    @class_decorator()',
  '    class Local(base_factory(), metaclass=meta_factory()):',
  '        eager = class_body()',
  '        @method_decorator()',
  '        def run(self, value=method_default()):',
  '            return method_body()',
  '        async def async_run(self, value=async_default()):',
  '            return await async_body()',
  '    return nested, Local',
  '',
  'class Outer:',
  '    @outer_method_decorator()',
  '    def run(self):',
  '        class Inner(inner_base()):',
  '            value = inner_body()',
  '            def run(self, value=inner_default()):',
  '                def local(value=local_default()):',
  '                    return local_body()',
  '                return local()',
  '        return Inner',
  ''
].join('\n');
try {
  const { lang, context } = await buildLanguageContext({ ext: '.py', relPath: 'header-ownership.py', mode: 'code', text,
    options: { astDataflowEnabled: true, controlFlowEnabled: true,
      pythonAst: { enabled: true, workerCount: 1, maxWorkers: 1, maxRetries: 0, taskTimeoutMs: 5000 } } });
  assert.ok(context.pythonAst && !context.pythonAst.error, 'the real CPython transport must supply the collector output');
  const definitions = new Map(context.pythonAst.defs.map(entry => [entry.name, entry]));
  const expected = new Map([
    ['factory', ['argument_type', 'base_factory', 'class_decorator', 'decorator_argument', 'function_decorator',
      'keyword_seed', 'meta_factory', 'result_type', 'seed']],
    ['factory.nested', ['function_body']],
    ['factory.Local', ['async_default', 'class_body', 'method_decorator', 'method_default']],
    ['factory.Local.run', ['method_body']],
    ['factory.Local.async_run', ['async_body']],
    ['Outer', ['outer_method_decorator']],
    ['Outer.run', ['inner_base']],
    ['Outer.run.Inner', ['inner_body', 'inner_default']],
    ['Outer.run.Inner.run', ['local', 'local_default']],
    ['Outer.run.Inner.run.local', ['local_body']]
  ]);
  const relations = await lang.buildRelations({ text, context, options: {} });
  const callIndex = buildCallIndex(relations);
  for (const [name, calls] of expected) {
    const definition = definitions.get(name);
    assert.ok(definition, name);
    assert.deepEqual(definition.calls, calls.toSorted(), `${name}: header and body facts stay separate`);
    const chunk = context.pythonChunks.find(entry => entry.name === name);
    const projected = buildChunkRelations({ lang, chunk, fileRelations: relations, callIndex });
    assert.deepEqual([...new Set((projected.calls || []).map(([, callee]) => callee))].sort(), calls.toSorted(),
      `${name}: real relation/chunk projection retains the same lexical owner`);
    assert.deepEqual([...new Set((projected.callDetails || []).map(detail => detail.callee))].sort(), calls.toSorted());
    assert.deepEqual(chunk.meta.dataflow.reads, definition.dataflow.reads);
  }
  assert.deepEqual(relations.calls.filter(([caller]) => caller === '(module)').map(([, callee]) => callee).sort(),
    ['module_argument', 'module_decorator', 'module_default']);
  assert.equal(definitions.get('factory.Local.run').kind, 'MethodDeclaration');
  assert.equal(definitions.get('factory.Local.async_run').kind, 'MethodDeclaration');
  assert.equal(definitions.get('Outer.run.Inner.run.local').kind, 'FunctionDeclaration');
  assert.equal(definitions.get('factory').controlFlow.returns, 1);
  assert.equal(definitions.get('factory.nested').controlFlow.returns, 1);
  assert.equal(definitions.get('factory.Local.async_run').controlFlow.awaits, 1);
  assert.equal(definitions.get('factory.Local').controlFlow.returns, 0, 'method bodies do not enter class return counters');
  assert.equal(definitions.get('factory.Local').controlFlow.awaits, 0, 'async method bodies do not enter class await counters');
  assert.ok(!definitions.get('factory.nested').dataflow.reads.includes('seed'));
  assert.ok(!definitions.get('factory.Local.run').dataflow.reads.includes('method_default'));
  assert.ok(!definitions.get('Outer.run').dataflow.reads.includes('inner_body'));
  console.log('Python declaration header, local class and relation ownership test passed');
} finally {
  await shutdownPythonAstPool();
}
