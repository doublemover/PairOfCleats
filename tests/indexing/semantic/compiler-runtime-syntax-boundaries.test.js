import assert from 'node:assert/strict';
import ts from 'typescript';
import { buildCompilerFlowGraph } from '../../../src/index/semantic/compiler-flow-graph.js';
const graph = text => {
  const sourceFile = ts.createSourceFile('fixture.ts', text, ts.ScriptTarget.Latest, true);
  const owner = sourceFile.statements[0];
  const flow = buildCompilerFlowGraph({ ts, owner, sourceFile,
    expressionFor: node => node ? { partitionId: 'fixture', localId: `${node.pos}:${node.end}` } : null });
  return { ...flow, sourceFile, owner };
};
const methods = graph('function f() { const o = { [keyProbe()](x = defaultProbe()) { bodyProbe(); }, [nextKey()]() {} }; afterProbe(); }');
const calls = methods.blocks.filter(block => block.event?.kind === 'operation' && ts.isCallExpression(block.event.target))
  .map(block => block.event.target.expression.getText(methods.sourceFile));
assert.deepEqual(calls.slice().sort(), ['afterProbe', 'keyProbe', 'nextKey'].sort());
for (const name of ['keyProbe', 'nextKey']) {
  const call = methods.blocks.find(block => block.event?.target?.expression?.getText(methods.sourceFile) === name);
  assert.ok(call.successors.some(edge => edge.kind === 'exceptional'), 'computed key evaluation may throw');
}
const declarations = graph('function f(x) { var x; var y = 7; var y; return x + y; }');
const writes = declarations.blocks.filter(block => block.event?.kind === 'write');
assert.equal(writes.filter(block => block.event.target.text === 'x').length, 1, 'bare var cannot overwrite the incoming parameter');
assert.equal(writes.find(block => block.event.target.text === 'x').event.origin, 'parameter');
assert.equal(writes.filter(block => block.event.target.text === 'y').length, 1, 'bare redeclaration cannot overwrite prior initializer');
for (const label of ['outer', 'inner']) {
  for (const iteration of ['for (let i = 0; i < 3; i++)', 'while (condition())', 'do']) {
    const body = iteration === 'do' ? `do { continue ${label}; } while(condition());` : `${iteration} { continue ${label}; }`;
    const flow = graph(`function f() { outer: inner: ${body} after(); }`);
    assert.equal(flow.reasons.has('unresolved_abrupt_target'), false);
    const abrupt = flow.blocks.find(block => block.event?.kind === 'abrupt');
    assert.equal(abrupt.successors.length, 1);
    assert.notEqual(abrupt.successors[0].to, flow.exception);
    assert.notEqual(abrupt.successors[0].to.event?.target?.expression?.getText(flow.sourceFile), 'after');
  }
}
console.log('computed member keys, bare var redeclarations and contiguous iteration labels');
