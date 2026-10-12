import assert from 'node:assert/strict';
import { prepareTypeScriptSyntax } from '../../../src/lang/typescript/syntax-context.js';
import { buildCompilerFlowGraph } from '../../../src/index/semantic/compiler-flow-graph.js';

const build = (text, fileName = 'class.ts') => {
  const { ts, sourceFile } = prepareTypeScriptSyntax(text, { ext: '.ts', fileName });
  const graph = buildCompilerFlowGraph({ ts, sourceFile, owner: sourceFile,
    expressionFor: node => node ? { partitionId: 'sy1:' + 'a'.repeat(64), localId: node.getStart(sourceFile) } : null });
  return { ...graph, ts, sourceFile };
};
const normalCalls = (graph, start = graph.entry) => {
  const calls = [], seen = new Set();
  for (let block = start; block && !seen.has(block);) {
    seen.add(block);
    if (graph.ts.isCallExpression(block.node) && block.event?.kind === 'operation') calls.push(block.node.expression.getText(graph.sourceFile));
    const normal = block.successors.filter(edge => edge.kind !== 'exceptional');
    assert.ok(normal.length <= 1, 'fixture normal path is straight-line');
    block = normal[0]?.to;
  }
  return calls;
};
const body = `extends base() {
  [firstKey()] = instanceOnly();
  static [secondKey()] = staticValue();
  static { block(); }
  [thirdKey()]() { methodOnly(); }
  static last = lastValue();
}`;
for (const declaration of [`class C ${body}`, `const C = class Inner ${body};`]) {
  const graph = build(declaration);
  assert.deepEqual(normalCalls(graph), ['base', 'firstKey', 'secondKey', 'thirdKey', 'staticValue', 'block', 'lastValue']);
  assert.ok(graph.reasons.has('class_storage_private_and_self_binding_effects_unresolved'));
  const conversions = graph.blocks.filter(block => graph.ts.isComputedPropertyName(block.node));
  assert.equal(conversions.length, 3);
  assert.ok(conversions.every(block => block.successors.some(edge => edge.kind === 'exceptional')), 'computed-key conversion can throw');
}
const caught = build('try { class C extends base() { static x = fail(); static { later(); } } after(); } catch (error) { recover(); } finally { clean(); }');
const failed = caught.blocks.find(block => caught.ts.isCallExpression(block.node)
  && block.node.expression.getText(caught.sourceFile) === 'fail' && block.event?.kind === 'operation');
assert.deepEqual(normalCalls(caught, failed.successors.find(edge => edge.kind === 'exceptional').to), ['recover', 'clean'],
  'initializer failure skips later class elements and routes through the enclosing catch/finally');
for (const [text, fileName] of [
  ['declare class C { [erasedKey()]: unknown; }', 'class.ts'],
  ['class C { [erasedKey()]: unknown; }', 'class.d.ts'],
  ['abstract class C { abstract [erasedKey()](): void; declare [declaredKey()]: unknown; static x = real(); }', 'class.ts']
]) {
  const graph = build(text, fileName);
  assert.deepEqual(normalCalls(graph), text.includes('real()') ? ['real'] : []);
}
const decorated = build('@decorate() class C { @field() static x = value(); }');
assert.ok(decorated.reasons.has('class_decorator_evaluation_and_replacement_unresolved'));
assert.deepEqual(normalCalls(decorated), ['value'], 'decorator effects stay an explicit frontier, not guessed execution');
console.log('Class heritage, computed-key and static initialization order, exception routing and erased-member handling passed');
