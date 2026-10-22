import assert from 'node:assert/strict';
import ts from 'typescript';
import { buildCompilerFlowGraph } from '../../../src/index/semantic/compiler-flow-graph.js';
const build = (text, extra = {}) => {
  const sourceFile = ts.createSourceFile('finally.ts', text, ts.ScriptTarget.Latest, true);
  return buildCompilerFlowGraph({ ts, sourceFile, owner: sourceFile.statements[0], expressionFor: node => node ? { localId: node.pos } : null, ...extra });
};
let body = 'cleanup();';
for (let depth = 0; depth < 10; depth++) body = `try { work(); } finally { ${body} }`;
const graph = build(`function f() { ${body} }`);
assert.equal(graph.truncated, false);
assert.ok(graph.stats.createdBlocks < 1000, 'nested finalizers share identical continuation contexts');
assert.ok(graph.stats.finalizerMemoHits > 0);
const bounded = build(`function f() { ${body} }`, { constructionLimits: { maxBlocks: 12, maxBytes: 8192, maxWork: 10000 } });
assert.equal(bounded.truncated, true); assert.deepEqual(bounded.blocks, []); assert.equal(bounded.entry, null);
assert.ok(bounded.reasons.has('cfg_construction_work_or_byte_budget'));
for (const statement of ['return 7;', 'throw fail;']) {
  const override = build(`function f() { try { return 1; } finally { ${statement} } }`);
  const pending = [override.entry], visited = new Set(); let returns = 0, throws = 0;
  while (pending.length) {
    const block = pending.pop(); if (visited.has(block)) continue; visited.add(block);
    if (block.event?.kind === 'return' && block.event.value?.getText() === '7') returns++;
    if (block.event?.kind === 'throw') throws++;
    for (const edge of block.successors) pending.push(edge.to);
  }
  assert.equal(statement.startsWith('return') ? returns > 0 : throws > 0, true);
  assert.equal(visited.has(override.exit), statement.startsWith('return'), 'finalizer throw suppresses normal return completion');
}
const controller = new AbortController(); controller.abort(new Error('stop CFG'));
assert.throws(() => build('function f() { return 1; }', { signal: controller.signal }), /stop CFG/);
console.log('finalizer sharing preserves continuation context and construction exhaustion stays partial');
