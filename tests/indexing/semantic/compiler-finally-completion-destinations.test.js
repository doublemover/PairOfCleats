import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { buildCompilerFlowGraph } from '../../../src/index/semantic/compiler-flow-graph.js';
import { collectCompilerCompletions } from '../../../src/index/semantic/compiler-completions.js';
import { buildCallDependencySummaries } from '../../../src/index/semantic/compiler-call-summaries.js';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';
import { validateSemanticPartitions } from '../../../src/index/semantic/reconcile.js';
import { canonicalSemanticJson } from '../../../src/index/semantic/identity.js';

// UNVALIDATED. Compiler syntax/CFG/retained summaries only. No source function,
// finalizer, loop, thrown value or cancellation callback is executed.
const cases = [
  { name: 'direct', body: 'return input;', returns: 1, implicit: 0, depends: [0] },
  { name: 'localCatch', body: 'try { return input; } finally { try { throw 0; } catch (error) {} }', returns: 1, implicit: 0, depends: [0] },
  { name: 'nestedCatch', body: 'try { return input; } finally { try { try { throw 0; } finally { let local = 1; } } catch (error) {} }', returns: 1, implicit: 0, depends: [0] },
  { name: 'restoredOuter', body: 'try { return input; } finally { try { try { return 7; } finally { throw 0; } } catch (error) {} }', returns: 1, implicit: 0, depends: [0] },
  { name: 'localBreak', body: 'try { return input; } finally { for (;;) { break; } }', returns: 1, implicit: 0, depends: [0] },
  { name: 'localContinue', body: 'try { return input; } finally { let again = true; do { again = false; continue; } while (again); }', returns: 1, implicit: 0, depends: [0] },
  { name: 'canceledBreak', body: 'outside: { try { return input; } finally { break outside; } }', returns: 1, implicit: 1, depends: [] },
  { name: 'canceledContinue', body: 'for (let i = 0; i < 1; i++) { try { return input; } finally { continue; } }', returns: 1, implicit: 1, depends: [] },
  { name: 'laterReturn', body: 'outside: { try { return input; } finally { break outside; } } return 7;', returns: 1, implicit: 0, depends: [] },
  { name: 'maybeCanceled', body: 'outside: { try { return input; } finally { if (flag) break outside; } }', returns: 2, implicit: 1, depends: [0] },
  { name: 'overridden', body: 'try { return input; } finally { return 7; }', returns: 1, implicit: 0, depends: [] },
  { name: 'maybeOverridden', body: 'try { return input; } finally { if (flag) return 7; }', returns: 2, implicit: 0, depends: [0] },
  { name: 'suppressed', body: 'try { return input; } finally { throw 0; }', returns: 0, implicit: 0, depends: [] }
];
const text = 'export {};\n' + cases.map(item => `function ${item.name}(input: number, flag: boolean) { ${item.body} }`).join('\n')
  + '\nconst expressionBody = (input: number) => input;';
const sourceFile = ts.createSourceFile('completion.ts', text, ts.ScriptTarget.Latest, true);
assert.equal(sourceFile.parseDiagnostics.length, 0);
const reachableFrom = entry => {
  const reached = new Set(), pending = [entry];
  while (pending.length) {
    const block = pending.pop(); if (reached.has(block)) continue;
    reached.add(block); for (const edge of block.successors) pending.push(edge.to);
  }
  return reached;
};
for (const item of cases) {
  const owner = sourceFile.statements.find(node => node.name?.text === item.name);
  const graph = buildCompilerFlowGraph({ ts, owner, sourceFile,
    expressionFor: node => node ? { partitionId: 'completion', localId: node.getStart(sourceFile) } : null });
  assert.notEqual(graph.exit, graph.returnExit);
  assert.equal(graph.exit.kind, 'exit'); assert.equal(graph.returnExit.kind, 'exit');
  const reached = reachableFrom(graph.entry);
  assert.equal(reached.has(graph.exit), item.implicit > 0, item.name + ' ordinary fallthrough matches actual completion destination');
  assert.equal(reached.has(graph.returnExit), item.returns > item.implicit, item.name + ' preserved/overridden return reaches a return destination');
  const completions = collectCompilerCompletions({ graph, maxBytes: 1024 * 1024, maxWork: 100000 });
  assert.equal(completions.complete, true);
  assert.equal(completions.returns.size, item.returns - item.implicit, item.name + ' exact source return origins survive suspended completion scopes');
  assert.equal(completions.normalExit, item.implicit > 0);
  const bounded = collectCompilerCompletions({ graph, maxBytes: 1, maxWork: 1 });
  assert.equal(bounded.complete, false); assert.equal(bounded.stats.admittedBytes, 0);
  assert.equal(bounded.returns.size, 0);
  const workBounded = collectCompilerCompletions({ graph, maxBytes: 1024 * 1024, maxWork: 1 });
  assert.equal(workBounded.complete, false); assert.equal(workBounded.stats.work, 2);
  assert.equal(workBounded.returns.size, 0);
  const controller = new AbortController(); controller.abort();
  assert.throws(() => collectCompilerCompletions({ graph, maxBytes: 1024 * 1024, maxWork: 100000, signal: controller.signal }), { name: 'AbortError' });
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-finally-completion-'));
try {
  const fixture = await createCompilerBoundaryFixture(root, { 'completion.ts': text }, {}, { withFlow: true });
  const doc = fixture.documents[0], flow = fixture.group.flowDocuments[0], store = fixture.storeFor(fixture.syntaxPartitions);
  await validateSemanticPartitions({ store, partitions: fixture.syntaxPartitions });
  const key = ref => ref.partitionId + ':' + ref.localId;
  const rows = new Map(), edges = [];
  for await (const row of store.iterateRows(flow.partition.partitionId, 'semantic_records')) rows.set(row.id, row);
  for await (const edge of store.iterateRows(flow.partition.partitionId, 'semantic_edges')) edges.push(edge);
  const dependencies = buildCallDependencySummaries([flow]);
  for (const item of cases) {
    const summary = flow.summaries.find(value => value.owner.name?.text === item.name);
    assert.equal(summary.returns.length, item.returns, item.name + ' actual retained return alternatives');
    const resultIds = new Set(summary.returns.map(key));
    const inputs = edges.filter(edge => edge.kind === 'returns' && resultIds.has(key(edge.to)));
    assert.equal(inputs.length, item.returns);
    const implicit = inputs.filter(edge => edge.from.partitionId === flow.partition.partitionId
      && rows.get(edge.from.localId)?.data.flags?.includes('implicit-return'));
    assert.equal(implicit.length, item.implicit, item.name + ' implicit undefined is separate from suspended return');
    const derived = dependencies.functions.get(canonicalSemanticJson(summary.declaration));
    assert.deepEqual([...derived.dependencies].sort(), item.depends,
      item.name + ' actual call-summary consumer preserves/suppresses the original input channel');
    if (item.name === 'localCatch' || item.name === 'localBreak') {
      const owner = summary.owner, originalReturn = owner.body.statements[0].tryBlock.statements[0];
      assert.deepEqual(inputs[0].from, doc.expressionFor(originalReturn.expression));
      assert.equal(summary.complete, false, 'finally and runtime effects retain their existing partial qualification');
    }
  }
  const arrow = flow.summaries.find(value => doc.ts.isArrowFunction(value.owner));
  assert.equal(arrow.returns.length, 1);
  assert.deepEqual([...dependencies.functions.get(canonicalSemanticJson(arrow.declaration)).dependencies], [0],
    'expression-bodied functions use the same explicit completion destination');
  console.log('actual CFG finalizer destinations, retained return rows and call-summary channels preserve completion alternatives');
} finally { await fs.rm(root, { recursive: true, force: true }); }
