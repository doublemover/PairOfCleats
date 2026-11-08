import assert from 'node:assert/strict';
import { buildLanguageContext, buildChunkRelations } from '../../../src/index/language-registry.js';
import { buildCallIndex } from '../../../src/index/build/file-processor/relations.js';
import { shutdownPythonAstPool } from '../../../src/lang/python.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const text = [
  'def outer(value):',
  '    callback = lambda item=default_seed(): delayed(item, (yield value))',
  '    nested = lambda: (lambda: deep())',
  '    return callback, nested',
  '',
  'class Owner:',
  '    callback = lambda: class_delayed()',
  '',
  'def defaults(callback=(lambda item=module_seed(): deferred_default(item))):',
  '    return ordinary()',
  ''
].join('\n');
try {
  const { lang, context } = await buildLanguageContext({ text, ext: '.py', relPath: 'lambda-owners.py', mode: 'code',
    options: { astDataflowEnabled: true, controlFlowEnabled: true,
      pythonAst: { enabled: true, workerCount: 1, maxWorkers: 1, maxRetries: 0, taskTimeoutMs: 5000 } } });
  assert.ok(context.pythonAst && !context.pythonAst.error, 'real CPython transport supplies the declaration and lambda observations');
  const definitions = new Map(context.pythonAst.defs.map(entry => [entry.name, entry]));
  assert.deepEqual(definitions.get('outer').calls, ['default_seed']);
  assert.deepEqual(definitions.get('Owner').calls, []);
  assert.deepEqual(definitions.get('defaults').calls, ['ordinary']);
  assert.equal(definitions.get('outer').yields, false, 'a deferred generator lambda does not make its enclosing function a generator');
  assert.equal(definitions.get('outer').modifiers.generator, false);
  assert.equal(definitions.get('outer').controlFlow.yields, 0);
  assert.ok(!definitions.get('outer').dataflow.reads.includes('delayed'));
  assert.ok(!definitions.get('outer').dataflow.reads.includes('deep'));
  assert.ok(definitions.get('outer').dataflow.reads.includes('default_seed'));
  assert.equal(definitions.get('outer').callOmissions.anonymousScopeCalls, 2);
  assert.equal(definitions.get('Owner').callOmissions.anonymousScopeCalls, 1);
  const relations = lang.buildRelations({ text, context, options: {} }), callIndex = buildCallIndex(relations);
  assert.equal(relations.callCoverage, 'partial');
  assert.ok(relations.callCoverageReasons.includes('anonymous_python_lambda_execution_unmodeled'));
  assert.deepEqual(relations.calls.filter(([caller]) => caller === '(module)'), [['(module)', 'module_seed']]);
  for (const name of ['outer', 'Owner', 'defaults']) {
    const chunk = context.pythonChunks.find(entry => entry.name === name);
    const selected = buildChunkRelations({ lang, chunk, fileRelations: relations, callIndex });
    assert.deepEqual(selected.calls, definitions.get(name).calls.map(callee => [name, callee]));
    assert.ok((selected.callDetails || []).every(detail => !detail.caller.includes('<lambda@')));
    if (name !== 'defaults') assert.equal(selected.callOmissions.anonymousScopeCalls, name === 'outer' ? 2 : 1);
  }
  const anonymous = relations.callDetails.filter(detail => detail.caller.includes('<lambda@'));
  assert.deepEqual(anonymous.map(detail => detail.callee).toSorted(), ['class_delayed', 'deep', 'deferred_default', 'delayed'].toSorted());
  assert.ok(anonymous.every(detail => !context.pythonChunks.some(chunk => chunk.meta.pythonScopeId === detail.callerScopeId)),
    'anonymous evidence is not presented as a resolved named declaration');
  console.log('Python lambda defaults, deferred body and registered chunk ownership test passed');
} finally {
  await shutdownPythonAstPool();
}
