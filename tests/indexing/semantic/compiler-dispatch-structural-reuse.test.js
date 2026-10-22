import assert from 'node:assert/strict';
import ts from 'typescript';
import { createCompilerDispatchResolver } from '../../../src/index/semantic/compiler-dispatch.js';
import { createCompilerStructuralQueries } from '../../../src/index/semantic/compiler-structural-queries.js';
const text = `function target() {} class C { ${Array.from({ length: 1000 }, (_, id) => `m${id}() {}`).join(' ')} get callback() { return target; } }
declare const flag:boolean; const A0=C;
${Array.from({ length: 12 }, (_, id) => `const A${id + 1}=flag?A${id}:A${id};`).join('\n')}
${Array.from({ length: 40 }, () => 'new C().m500(); new C().callback();').join('\n')}`;
const sourceFile = ts.createSourceFile('dispatch.ts', text, ts.ScriptTarget.Latest, true);
const options = { noLib: true, target: ts.ScriptTarget.Latest }, host = ts.createCompilerHost(options);
host.getSourceFile = name => name === sourceFile.fileName ? sourceFile : undefined;
host.fileExists = name => name === sourceFile.fileName; host.readFile = () => text;
const program = ts.createProgram([sourceFile.fileName], options, host), checker = program.getTypeChecker();
const nodes = [], pending = [sourceFile];
while (pending.length) { const node = pending.pop(); nodes.push(node); ts.forEachChild(node, child => { pending.push(child); }); }
const declarationRef = node => node ? { partitionId: 'dispatch', localId: node.getStart(sourceFile) } : null;
const resolve = createCompilerDispatchResolver({ ts, checker, nodes, declarationRef });
const calls = nodes.filter(node => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression));
const method = nodes.find(node => ts.isMethodDeclaration(node) && node.name.text === 'm500');
const target = sourceFile.statements[0];
for (const call of calls) {
  const result = resolve(call);
  assert.deepEqual(result.targets, [declarationRef(call.expression.name.text === 'm500' ? method : target)]);
  assert.equal(result.incomplete, true, 'member candidates do not prove runtime dispatch');
  assert.ok(result.reasons.includes('property_dispatch_prototype_accessor_or_escape_unobserved'));
}
assert.equal(resolve.stats.classQueries, 1, 'same depth-zero constructor symbol reuses its structural class closure');
assert.equal(resolve.stats.memberBuilds, 1); assert.equal(resolve.stats.accessorScans, 1);
assert.equal(resolve.stats.membersVisited, 1001); assert.equal(resolve.stats.matchedMemberRows, calls.length);
const structural = createCompilerStructuralQueries({ ts, checker });
const getter = nodes.find(node => ts.isGetAccessorDeclaration(node));
const firstReasons = new Set(), nextReasons = new Set();
assert.equal(structural.returns(getter, firstReasons), structural.returns(getter, nextReasons));
assert.deepEqual(nextReasons, firstReasons);
assert.ok(nextReasons.has('accessor_return_execution_and_completion_conservative'));
assert.equal(structural.stats.accessorScans, 1);
const aliased = nodes.find(node => ts.isVariableDeclaration(node) && node.name.text === 'A12').name;
const aliasReasons = new Set(), replayReasons = new Set();
const aliasClasses = structural.classes(aliased, aliasReasons);
assert.deepEqual(aliasClasses, [sourceFile.statements[1]], 'duplicate diamond paths retain one class candidate');
assert.ok(aliasReasons.has('class_alias_work_budget'), 'one shared allowance bounds descent across every branch');
assert.equal(structural.classes(aliased, replayReasons), aliasClasses, 'immutable partial results remain group-owned');
assert.deepEqual(replayReasons, aliasReasons, 'a cached partial class closure replays its frontier reasons');
console.log('dispatch member indexes and accessor/class summaries reuse immutable structure only');
