#!/usr/bin/env node
import assert from 'node:assert/strict';
import { loadTypeScriptModule } from '../../src/lang/typescript/parser.js';
import { createTypeScriptNodeIndex } from '../../src/index/tooling/typescript/node-index.js';
const ts = loadTypeScriptModule(process.cwd());
assert.ok(ts);
const source = ts.createSourceFile('fixture.ts', 'const π = 1; function f(x: number) { const x2 = x + π; return x2; } function f2() { return f(2); }', ts.ScriptTarget.Latest, true);
let scans = 0;
const counting = { ...ts, forEachChild(node, visit) { scans += 1; return ts.forEachChild(node, visit); } };
const name = (_ts, node) => node.name && ts.isIdentifier(node.name) ? node.name.text : null;
const index = createTypeScriptNodeIndex(counting, source, name);
assert.equal(scans, index.nodeCount);
const nodes = [];
const visit = node => { nodes.push(node); ts.forEachChild(node, visit); };
visit(source);
for (let start = 0; start < source.text.length; start += 3) {
  const range = { start, end: Math.min(start + 12, source.text.length) };
  const expected = nodes.filter(node => Math.min(node.end, range.end) - Math.max(node.getStart(source), range.start) > 0);
  assert.deepEqual(new Set(index.overlapping(range).map(row => row.node)), new Set(expected));
}
assert.equal(scans, index.nodeCount, 'queries must not traverse the AST again');
assert.equal(index.named('f').length, 1);
assert.deepEqual(index.overlapping({ start: 2, end: 2 }), []);
console.log('single compiler-document scan preserves exact overlap lookup');
