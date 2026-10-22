import assert from 'node:assert/strict';
import { getPythonAst, shutdownPythonAstPool, buildPythonChunksFromAst } from '../../../src/lang/python.js';
const text = '@route("/unique")\ndef factory():\n class A:\n  def run(self):\n   return alpha()\n class B:\n  async def run(self):\n   return beta()\n return A,B\n';
try {
  const parsed = await getPythonAst(text, null, {dataflow:true,controlFlow:true});
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
} finally { await shutdownPythonAstPool(); }
console.log('Python local class scope facts remain distinct');