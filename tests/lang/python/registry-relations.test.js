import assert from 'node:assert/strict';
import { buildLanguageContext } from '../../../src/index/language-registry.js';
import { shutdownPythonAstPool } from '../../../src/lang/python.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const text = 'from .subpackage import helper\nimport pkg\ndef f(value):\n    return pkg.g(helper(value))\n';
const input = { ext: '.py', relPath: 'package/service.py', mode: 'code', text,
  options: { pythonAst: { enabled: true, workerCount: 1, maxWorkers: 1, maxRetries: 0, taskTimeoutMs: 5000 } } };
try {
  const { lang, context } = await buildLanguageContext(input);
  assert.ok(context.pythonAst, 'the positive uses the real Python worker');
  const relations = lang.buildRelations({ ...input, context });
  assert.deepEqual(relations.imports, ['.subpackage', 'pkg']);
  assert.deepEqual(relations.exports, ['f']);
  assert.deepEqual(relations.calls, [['f', 'pkg.g'], ['f', 'helper']]);
  assert.deepEqual(relations.callDetails, [
    { caller: 'f', callerScopeId: 'f@3:0', callee: 'pkg.g', args: ['helper(...)'] },
    { caller: 'f', callerScopeId: 'f@3:0', callee: 'helper', args: ['value'] }
  ]);
  assert.ok(relations.usages.includes('pkg') && relations.usages.includes('helper') && relations.usages.includes('value'));
  for (const field of ['imports', 'exports', 'calls', 'callDetails', 'usages']) assert.deepEqual(relations[field], context.pythonAst[field]);
  const fallback = await buildLanguageContext({ ...input, options: { pythonAst: { enabled: false } } });
  assert.equal(fallback.context.pythonAst, null);
  assert.deepEqual(fallback.lang.buildRelations({ ...input, context: fallback.context }).imports.sort(), ['.subpackage', 'pkg']);
} finally { await shutdownPythonAstPool(); }
console.log('Python registry preserves real AST imports/exports/calls/details/usages and no-AST import fallback.');
