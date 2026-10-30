import assert from 'node:assert/strict';
import { getPythonAst, shutdownPythonAstPool, buildPythonChunksFromAst } from '../../../src/lang/python.js';
import { getLanguageForFile, buildChunkRelations } from '../../../src/index/language-registry.js';
import { buildCallIndex } from '../../../src/index/build/file-processor/relations.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const text = '@route("/unique")\ndef factory():\n class A:\n  def run(self):\n   return alpha()\n class B:\n  async def run(self):\n   return beta()\n'
  + ' def repeated():\n  return version_one()\n def repeated():\n  return version_two()\n return A,B\n'
  + 'class Outer:\n def run(self):\n  class Inner:\n   def run(self):\n    return inner_call()\n'
  + '  def nested():\n   return nested_call()\n  return Inner\n';
try {
  const parsed = await getPythonAst(text, null, {dataflow:true,controlFlow:true,
    pythonAst: { workerCount: 1, maxWorkers: 1, maxRetries: 0, taskTimeoutMs: 5000 }});
  assert.ok(parsed?.ast && !parsed.ast.error, JSON.stringify(parsed?.ast));
  const a = parsed.ast.defs.find(row => row.name === 'factory.A.run');
  const b = parsed.ast.defs.find(row => row.name === 'factory.B.run');
  assert.equal(a.kind,'MethodDeclaration'); assert.equal(b.kind,'MethodDeclaration');
  assert.deepEqual(a.calls,['alpha']); assert.deepEqual(b.calls,['beta']);
  assert.deepEqual(a.dataflow.reads,['alpha']); assert.deepEqual(b.dataflow.reads,['beta']);
  assert.equal(a.controlFlow.returns,1); assert.equal(b.controlFlow.returns,1);
  assert.notEqual(a.scopeId,b.scopeId);
  const chunks = buildPythonChunksFromAst(text,parsed.ast);
  const factory = chunks.find(row => row.name === 'factory');
  assert.equal(factory.start,0); assert.equal(factory.meta.startLine,1); assert.equal(factory.meta.definitionStartLine,2);
  assert.ok(text.slice(factory.start,factory.end).includes('/unique'));
  const expected = new Map([
    ['factory.A.run', ['alpha']], ['factory.B.run', ['beta']],
    ['Outer.run.Inner.run', ['inner_call']], ['Outer.run.nested', ['nested_call']]
  ]);
  const lang = getLanguageForFile('.py', 'local-classes.py');
  const context = { pythonAst: parsed.ast, pythonChunks: chunks };
  const relations = lang.buildRelations({ text, context });
  const index = buildCallIndex(relations);
  assert.equal(chunks.filter(row => expected.has(row.name)).length, expected.size, 'every requested lexical consumer exists');
  for (const chunk of chunks.filter(row => expected.has(row.name))) {
    const wanted = expected.get(chunk.name);
    const projected = buildChunkRelations({ lang, chunk, fileRelations: relations, callIndex: index });
    assert.deepEqual(projected.calls.map(([, name]) => name).sort(), wanted);
    assert.deepEqual(projected.callDetails.map(row => row.callee).sort(), wanted);
    const doc = lang.extractDocMeta({ chunk, context, fileRelations: relations });
    assert.deepEqual(doc.dataflow.reads, wanted, `${chunk.name}: public metadata retains only owned reads`);
    assert.equal(doc.controlFlow.returns, 1);
    assert.equal(chunk.kind, chunk.name.endsWith('.nested') ? 'FunctionDeclaration' : 'MethodDeclaration');
  }
  const repeated = chunks.filter(row => row.name === 'factory.repeated');
  assert.equal(repeated.length, 2);
  assert.notEqual(repeated[0].meta.pythonScopeId, repeated[1].meta.pythonScopeId);
  for (const [position, chunk] of repeated.entries()) {
    const wanted = [position === 0 ? 'version_one' : 'version_two'];
    assert.deepEqual(buildChunkRelations({ lang, chunk, fileRelations: relations, callIndex: index }).calls.map(([, name]) => name), wanted,
      'same-named redefinitions join by declaration scope rather than merging names');
    assert.deepEqual(lang.extractDocMeta({ chunk, context, fileRelations: relations }).dataflow.reads, wanted);
  }
  assert.ok(chunks.some(row => row.name === 'factory.A' && row.kind === 'ClassDeclaration'));
  assert.ok(chunks.some(row => row.name === 'factory.B' && row.kind === 'ClassDeclaration'));
  assert.ok(chunks.some(row => row.name === 'Outer.run.Inner' && row.kind === 'ClassDeclaration'));
} finally { await shutdownPythonAstPool(); }
console.log('Python local class scope facts remain distinct');
