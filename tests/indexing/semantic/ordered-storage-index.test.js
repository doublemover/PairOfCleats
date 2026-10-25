import assert from 'node:assert/strict';
import ts from 'typescript';
import { createCompilerOrderedStorage, indexCompilerOrderedStorage } from '../../../src/index/semantic/compiler-ordered-storage.js';

const sample = (count, withViews = false) => {
  const text = Array.from({ length: count }, (_, index) => withViews
    ? `function f${index}(){const b${index}=new Uint8Array([1,2]);const holder${index}={view:(b${index}.subarray(1).subarray(0) as Uint8Array)};holder${index}.view[0]=3;return b${index}[1];}`
    : `function f${index}(x:number){return x+${index};}`).join('\n');
  const sourceFile = ts.createSourceFile('probe.ts', text, ts.ScriptTarget.Latest, true), nodes = [];
  const visit = node => { nodes.push(node); ts.forEachChild(node, visit); }; visit(sourceFile);
  let visits = 0, lookups = 0, signatures = 0;
  const track = values => new Proxy(values, { get(target, key, receiver) {
    if (typeof key === 'string' && /^\d+$/.test(key)) visits++;
    return Reflect.get(target, key, receiver);
  } });
  const declarations = new Map(nodes.filter(ts.isVariableDeclaration).map(node => [node.name.text, node]));
  const library = {};
  const checker = {
    getSymbolAtLocation(node) { lookups++; return { valueDeclaration: declarations.get(node.text) }; },
    getResolvedSignature(node) {
      signatures++;
      return { declaration: { parent: { name: { text: ts.isNewExpression(node) ? 'Uint8ArrayConstructor' : 'Uint8Array' } },
        name: { text: node.expression.name?.text }, getSourceFile: () => library } };
    }
  };
  const index = indexCompilerOrderedStorage({ ts, checker, sourceFile, nodes: track(nodes) });
  for (const [owner, bucket] of index.buckets) index.buckets.set(owner, track(bucket));
  for (const owner of [sourceFile, ...nodes.filter(node => ts.isFunctionLike(node) && node.body)]) {
    createCompilerOrderedStorage({ ts, checker, isDefaultLibrary: file => file === library, owner, sourceFile, nodes,
      index, expressionFor: node => ({ partitionId: 'sy1:' + 'a'.repeat(64), localId: node.pos }) });
  }
  assert.ok(lookups <= nodes.length, 'each source identifier needs at most one checker lookup');
  assert.ok(signatures <= nodes.length, 'view authority reuses the owner-local descriptor memo');
  assert.ok(visits <= nodes.length * 4, 'owner discovery and storage passes have linear node work');
  return { functions: count, withViews, nodes: nodes.length, visits, lookups, signatures };
};
const results = [100, 200, 400].map(sample);
assert.ok(results[2].visits < results[0].visits * 4.1);
const viewResults = [30, 60, 120].map(count => sample(count, true));
assert.ok(viewResults[2].visits < viewResults[0].visits * 4.1);
const aborted = new AbortController(); aborted.abort();
assert.throws(() => indexCompilerOrderedStorage({ ts, checker: {}, sourceFile: {}, nodes: [{}], signal: aborted.signal }),
  { name: 'AbortError' });
console.log('One document owner index bounds allocation-free and nested-view ordered-storage work', [...results, ...viewResults]);
