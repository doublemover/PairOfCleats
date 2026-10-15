import assert from 'node:assert/strict';
import ts from 'typescript';
import { createCompilerOrderedStorage, indexCompilerOrderedStorage } from '../../../src/index/semantic/compiler-ordered-storage.js';

const sample = count => {
  const text = Array.from({ length: count }, (_, index) => `function f${index}(x:number){return x+${index};}`).join('\n');
  const sourceFile = ts.createSourceFile('probe.ts', text, ts.ScriptTarget.Latest, true), nodes = [];
  const visit = node => { nodes.push(node); ts.forEachChild(node, visit); }; visit(sourceFile);
  let visits = 0, lookups = 0;
  const track = values => new Proxy(values, { get(target, key, receiver) {
    if (typeof key === 'string' && /^\d+$/.test(key)) visits++;
    return Reflect.get(target, key, receiver);
  } });
  const checker = { getSymbolAtLocation() { lookups++; return null; } };
  const index = indexCompilerOrderedStorage({ ts, checker, sourceFile, nodes: track(nodes) });
  for (const [owner, bucket] of index.buckets) index.buckets.set(owner, track(bucket));
  for (const owner of [sourceFile, ...nodes.filter(node => ts.isFunctionLike(node) && node.body)]) {
    createCompilerOrderedStorage({ ts, checker, isDefaultLibrary: () => false, owner, sourceFile, nodes,
      index, expressionFor: node => ({ partitionId: 'sy1:' + 'a'.repeat(64), localId: node.pos }) });
  }
  assert.ok(lookups <= nodes.length, 'each source identifier needs at most one checker lookup');
  assert.ok(visits <= nodes.length * 4, 'owner discovery and storage passes have linear node work');
  return { functions: count, nodes: nodes.length, visits, lookups };
};
const results = [100, 200, 400].map(sample);
assert.ok(results[2].visits < results[0].visits * 4.1);
const aborted = new AbortController(); aborted.abort();
assert.throws(() => indexCompilerOrderedStorage({ ts, checker: {}, sourceFile: {}, nodes: [{}], signal: aborted.signal }),
  { name: 'AbortError' });
console.log('One document owner index bounds allocation-free ordered-storage work', results);
