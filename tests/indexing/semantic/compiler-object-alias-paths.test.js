import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';
import { createCompilerFieldPaths, collectCompilerAliasAssignments } from '../../../src/index/semantic/compiler-flow-fields.js';
import { createCompilerDispatchResolver } from '../../../src/index/semantic/compiler-dispatch.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-object-alias-'));
try {
  const fixture = await createCompilerBoundaryFixture(root, { 'input.ts': `export {};
    function first(){return 1;} function second(){return 2;}
    function run(flag:boolean) {
      const leaf={value:17}; const source={nested:leaf, other:91};
      const cycle={nested:cycle}; const cycleRead=cycle.nested.nested.value;
      const shorthand={leaf}; const copied={...source}; const {nested:renamed}=copied;
      const {nested:{value:scalar}}=copied;
      const [arrayAlias]=[leaf];
      const {missing:defaultAlias=leaf}=source;
      const {...rest}=source;
      const a=renamed.value, b=copied.nested.value, c=arrayAlias.value, d=defaultAlias.value;
      let {nested:mutable}=source; mutable={value:29}; const mutableRead=mutable.value;
      const shorthandRead=shorthand.leaf.value; const sourceRead=source.nested.value; const arrayRead=[... [leaf]][0].value;
      const left={call:first}, right={call:second}; let receiver=left; receiver=right;
      receiver.call(); (flag ? left : right).call(); (left || right).call();
      return scalar;
    }
    class Base { call(){return 3;} } const Parent=Base; class Child extends Parent {}
    new Child().call();
  ` }, {}, { withFlow: true });
  const doc = fixture.documents[0], { ts, checker, nodes, sourceFile, expressionFor } = doc;
  const declarationFor = node => { const anchor = node.name || node; return doc.item.declarations.get(anchor.getStart() + ':' + anchor.end); };
  const declarationRef = node => declarationFor(node) || (ts.isFunctionLike(node) ? expressionFor(node) : null);
  const reasons = new Set(), owner = sourceFile.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === 'run');
  const fields = createCompilerFieldPaths({ ts, checker, owner, sourceFile, assignments: collectCompilerAliasAssignments(ts, checker, nodes), expressionFor, declarationFor, depthLimit: 8, reasons });
  const find = text => nodes.find(node => node.getText() === text && (ts.isPropertyAccessExpression(node) || ts.isIdentifier(node)));
  const seventeen = nodes.find(node => ts.isNumericLiteral(node) && node.text === '17');
  for (const text of ['renamed.value', 'copied.nested.value', 'arrayAlias.value', 'defaultAlias.value', 'source.nested.value', 'shorthand.leaf.value', '[... [leaf]][0].value']) {
    const locations = fields.locationsFor(find(text));
    assert.ok(locations.some(location => location.initializers.some(ref => JSON.stringify(ref) === JSON.stringify(expressionFor(seventeen)))), `${text} retains the nested literal initializer`);
  }
  const mutable = fields.locationsFor(find('mutable.value'));
  const twentyNine = nodes.find(node => ts.isNumericLiteral(node) && node.text === '29');
  assert.ok(mutable.some(location => location.initializers.some(ref => JSON.stringify(ref) === JSON.stringify(expressionFor(twentyNine)))), 'mutable destructured aliases retain reassigned allocations');
  assert.deepEqual(fields.rootsFor(find('renamed'))[0].path, ['nested']);
  assert.deepEqual(fields.rootsFor(find('scalar'))[0].path, ['nested', 'value']);
  assert.deepEqual(fields.rootsFor(find('rest')), [], 'rest creates a copy, never aliases the original object');
  assert.ok(reasons.has('field_binding_rest_copy_unresolved'));
  assert.ok(reasons.has('field_binding_snapshot_and_escape_conservative'));
  assert.ok(reasons.has('field_initial_spread_or_computed_override'));
  assert.ok(fields.locationsFor(find('cycle.nested.nested.value')).every(location => location.initializers.length === 0), 'cyclic allocation aliases terminate without invented initializers');
  assert.ok(reasons.has('field_initial_alias_budget_or_cycle'));
  const boundedReasons = new Set();
  const boundedFields = createCompilerFieldPaths({ ts, checker, owner, sourceFile, expressionFor, declarationFor, depthLimit: 1, reasons: boundedReasons });
  assert.deepEqual(boundedFields.rootsFor(find('scalar')), []);
  assert.ok(boundedReasons.has('field_binding_depth_budget'));
  const resolver = createCompilerDispatchResolver({ ts, checker, nodes, declarationRef });
  const refs = ['first', 'second'].map(name => declarationRef(sourceFile.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === name)));
  for (const text of ['receiver.call()', '(flag ? left : right).call()', '(left || right).call()']) {
    const result = resolver(nodes.find(node => ts.isCallExpression(node) && node.getText() === text));
    for (const ref of refs) assert.ok(result.targets.some(target => JSON.stringify(target) === JSON.stringify(ref)), `${text} retains both receiver candidates`);
    assert.equal(result.incomplete, true, 'source candidates do not close runtime dispatch');
  }
  const inherited = resolver(nodes.find(node => ts.isCallExpression(node) && node.getText() === 'new Child().call()'));
  assert.equal(inherited.targets.length, 1, 'class heritage aliases retain inherited methods');
  const store = fixture.storeFor(fixture.syntaxPartitions), edges = [];
  for (const partition of fixture.syntaxPartitions) for await (const edge of store.iterateRows(partition.partitionId, 'semantic_edges')) edges.push(edge);
  const key = ref => ref.partitionId + ':' + ref.localId;
  const reached = new Set([key(expressionFor(seventeen))]);
  for (const ref of reached) for (const edge of edges) if (key(edge.from) === ref && ['packs', 'flowsTo', 'reads', 'writes', 'defines'].includes(edge.kind)) reached.add(key(edge.to));
  assert.ok(reached.has(key(expressionFor(find('renamed.value')))), 'nested destructuring initializer reaches the actual CFG read');
  console.log('Bounded destructuring, nested spread paths and mutable receiver dispatch passed');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
