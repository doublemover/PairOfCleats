import assert from 'node:assert/strict';
import { buildLanguageContext, buildChunkRelations } from '../../../src/index/language-registry.js';
import { applyRelationInferenceBudget, buildCallIndex } from '../../../src/index/build/file-processor/relations.js';
import { attachCallDetailsByChunkIndex } from '../../../src/index/build/file-processor/process-chunks/dedupe.js';
import { shutdownPythonAstPool } from '../../../src/lang/python.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const text = [
  'def factory():',
  '    class Local:',
  '        def run(self, seed=first_default()):',
  '            return first_body()',
  '    class Local:',
  '        def run(self, seed=second_default()):',
  '            return second_body()',
  '    def repeated():',
  '        return first_function()',
  '    def repeated():',
  '        return second_function()',
  '    return Local, repeated',
  ''
].join('\r\n');
try {
  const { lang, context } = await buildLanguageContext({ text, ext: '.py', relPath: 'repeated.py', mode: 'code',
    options: { astDataflowEnabled: true, controlFlowEnabled: true,
      pythonAst: { enabled: true, workerCount: 1, maxWorkers: 1, maxRetries: 0, taskTimeoutMs: 5000 } } });
  assert.ok(context.pythonAst && !context.pythonAst.error, 'real CPython transport supplies scoped observations');
  const relations = lang.buildRelations({ text, context, options: {} });
  const callIndex = buildCallIndex(relations);
  const rangedRelations = { ...relations, callDetails: relations.callDetails.map(detail => {
    const start = text.indexOf(detail.callee + '(');
    return { ...detail, start, end: text.indexOf(')', start) + 1 };
  }) };
  const rangedIndex = buildCallIndex(rangedRelations);
  attachCallDetailsByChunkIndex(rangedIndex, context.pythonChunks);
  assert.ok(rangedIndex.callDetailsByChunkIndex instanceof Map, 'real geometric index supplies the competing range owner');
  for (const [name, expected] of [
    ['factory.Local', [['first_default'], ['second_default']]],
    ['factory.Local.run', [['first_body'], ['second_body']]],
    ['factory.repeated', [['first_function'], ['second_function']]]
  ]) {
    const chunks = context.pythonChunks.filter(chunk => chunk.name === name);
    assert.equal(chunks.length, 2);
    assert.notEqual(chunks[0].meta.pythonScopeId, chunks[1].meta.pythonScopeId, 'coordinates disambiguate equal display names');
    chunks.forEach((chunk, index) => {
      const definition = context.pythonAst.defs.find(entry => entry.scopeId === chunk.meta.pythonScopeId);
      assert.deepEqual(definition.calls, expected[index]);
      for (const [selectedRelations, selectedIndex] of [[relations, null], [relations, callIndex], [rangedRelations, rangedIndex]]) {
        const selected = buildChunkRelations({ lang, chunk, fileRelations: selectedRelations, callIndex: selectedIndex,
          chunkIndex: context.pythonChunks.indexOf(chunk) });
        assert.deepEqual(selected.calls, expected[index].map(callee => [name, callee]));
        assert.deepEqual(selected.callDetails.map(detail => detail.callee), expected[index]);
        assert.ok(selected.callDetails.every(detail => detail.callerScopeId === chunk.meta.pythonScopeId));
        assert.equal(selected.callCoverage, 'partial-python-syntax-lexical-ownership');
      }
    });
  }
  const first = context.pythonChunks.find(chunk => chunk.name === 'factory.Local.run');
  const budgeted = { ...relations, calls: [...relations.calls], callDetails: [...relations.callDetails] };
  applyRelationInferenceBudget({ relations: budgeted, maxCalls: 1, maxCallDetails: 1 });
  const selected = buildChunkRelations({ lang, chunk: first, fileRelations: budgeted, callIndex: buildCallIndex(budgeted) });
  assert.deepEqual(selected.calls, [], 'scope projection cannot restore calls removed by the existing inference limits');
  assert.equal(selected.callDetails, undefined, 'scope projection cannot restore removed detail observations');
  console.log('repeated Python declaration call ownership through registered projection test passed');
} finally {
  await shutdownPythonAstPool();
}
