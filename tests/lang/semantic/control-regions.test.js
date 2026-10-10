import assert from 'node:assert/strict';
import { prepareTypeScriptSyntax } from '../../../src/lang/typescript/syntax-context.js';
import { buildCompilerFlowGraph } from '../../../src/index/semantic/compiler-flow-graph.js';

const build = text => {
  const { ts, sourceFile } = prepareTypeScriptSyntax(text, { ext: '.ts' });
  const graph = buildCompilerFlowGraph({ ts, sourceFile, owner: sourceFile.statements[0],
    expressionFor: node => node ? { partitionId: 'sy1:' + 'a'.repeat(64), localId: node.getStart(sourceFile) } : null });
  return { ...graph, ts, sourceFile };
};
const reachable = (start, stop = null) => {
  const seen = new Set(), pending = [start];
  while (pending.length) {
    const block = pending.pop();
    if (!block || seen.has(block) || block === stop) continue;
    seen.add(block);
    for (const edge of block.successors) if (edge.kind !== 'exceptional') pending.push(edge.to);
  }
  return seen;
};
const calls = (blocks, graph) => [...blocks].filter(block => graph.ts.isCallExpression(block.node)
  && block.event?.kind === 'operation').map(block => block.node.getText(graph.sourceFile));

const optional = build('function optional(a: any) { return a?.[key()].method(arg()); }');
const guard = optional.blocks.find(block => block.event?.predicate?.operation === 'isNullish');
assert.ok(guard);
assert.deepEqual(calls(reachable(guard.successors.find(edge => edge.kind === 'controlTrue').to), optional), [],
  'nullish receiver skips all subsequent keys, members and arguments in its chain region');
const activeCalls = calls(reachable(guard.successors.find(edge => edge.kind === 'controlFalse').to), optional);
assert.ok(activeCalls.includes('key()') && activeCalls.includes('arg()'));
assert.ok(!optional.reasons.has('optional_chain_continuation_requires_guard_region'));

const grouped = build('function grouped(a: any) { return (a?.method)(arg()); }');
const groupedGuard = grouped.blocks.find(block => block.event?.predicate?.operation === 'isNullish');
assert.ok(calls(reachable(groupedGuard.successors.find(edge => edge.kind === 'controlTrue').to), grouped).includes('arg()'),
  'parentheses terminate the optional region, preserving argument side effects');

for (const abrupt of ['break', 'continue']) {
  const graph = build(`function labeled(again: boolean) { outer: while (again) { try { ${abrupt} outer; } finally { cleanup(); } } }`);
  const jump = graph.blocks.find(block => block.event?.kind === 'abrupt');
  const first = jump.successors[0].to;
  const walked = new Set(), pending = [first];
  let sawCleanup = false;
  while (pending.length) {
    const block = pending.pop(); if (!block || walked.has(block)) continue; walked.add(block);
    if (graph.ts.isCallExpression(block.node) && block.event?.kind === 'operation'
      && block.node.expression.getText(graph.sourceFile) === 'cleanup') { sawCleanup = true; continue; }
    assert.notEqual(block, graph.exit, 'labeled abrupt completion cannot bypass finally');
    if (block.event?.kind === 'condition') assert.fail('continue cannot reach its loop condition before finally');
    for (const edge of block.successors) if (edge.kind !== 'exceptional') pending.push(edge.to);
  }
  assert.ok(sawCleanup);
}

const iteration = build('function iterate() { for (const value of getValues()) { use(value); } }');
const next = iteration.blocks.find(block => block.event?.predicate?.operation === 'iteratorHasNext');
assert.ok(next);
assert.ok(!calls(reachable(next), iteration).includes('getValues()'), 'the iterable expression is evaluated once before iteration');
const binding = iteration.blocks.find(block => block.event?.kind === 'write' && block.event.target.getText(iteration.sourceFile) === 'value');
assert.equal(binding.event.origin, 'unknown', 'the iterable itself is never asserted to be the yielded value');
console.log('optional-chain guard regions, labeled finally routes and single iterator initialization passed');
