import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';
import { collectCompilerValueSlice } from '../../../src/index/semantic/compiler-value-slice.js';
import { collectCompilerImplicitCalls } from '../../../src/index/semantic/compiler-implicit-calls.js';
import { createCompilerRuntimeContext } from '../../../src/index/semantic/compiler-runtime-context.js';
import { buildCompilerFlowGraph } from '../../../src/index/semantic/compiler-flow-graph.js';
import { createSemanticCompilerSession } from '../../../src/index/semantic/compiler-session.js';
import { createTypeScriptNodeIndex } from '../../../src/index/tooling/typescript/node-index.js';
import { validateSemanticPartitions } from '../../../src/index/semantic/reconcile.js';

// Authored only. Real compiler tree/checker, immutable rows and production session.
// Source functions, decorators, computed names and getters never execute.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-erased-runtime-'));
try {
  const text = `export {};
    const numberValue = 41, key = 'other';
    const Base = class {};
    const holder = { get key(): 'entry' { return 'entry'; } };
    function makeKey(): 'entry' { return 'entry'; }
    interface Top { [holder.key](): typeof numberValue; }
    interface CalledName { [makeKey()](): typeof numberValue; }
    declare class Ambient { static [holder.key]: typeof numberValue; }
    function factory(this: { tag: string }, argument: typeof numberValue = numberValue) {
      type Local = typeof numberValue;
      type Signature = (input: typeof numberValue) => typeof numberValue;
      interface Required extends InstanceType<typeof Base> { [holder.key](): typeof numberValue; }
      class Child extends Base implements Required {
        [holder.key](): typeof numberValue { return numberValue; }
        [key]() { return numberValue; }
      }
      const snapshot = numberValue as typeof numberValue;
      const shorthand = { numberValue };
      return { Child, snapshot, shorthand, argument };
    }
    const liveKey = makeKey();
    export { numberValue };
  `;
  const fixture = await createCompilerBoundaryFixture(root, { 'runtime.ts': text }, {}, { withFlow: true });
  const doc = fixture.documents[0], { ts, checker, nodes, sourceFile, expressionFor } = doc;
  assert.equal(sourceFile.parseDiagnostics.length, 0);
  const context = createCompilerRuntimeContext(ts), keyFor = ref => ref.partitionId + ':' + ref.localId;
  const insideErasedFixture = node => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isTypeQueryNode(parent) || ts.isInterfaceDeclaration(parent)
        || ts.isClassDeclaration(parent) && parent.name?.text === 'Ambient') return true;
    }
    return false;
  };
  const erased = nodes.filter(node => ts.isIdentifier(node) && ['numberValue', 'holder', 'Base'].includes(node.text)
    && insideErasedFixture(node));
  assert.ok(erased.length >= 10, 'actual annotations, aliases, interface keys/heritage and ambient keys are represented');
  assert.ok(erased.every(node => !context.isRuntimeNode(node)));
  const factory = sourceFile.statements.find(node => node.name?.text === 'factory');
  const graph = buildCompilerFlowGraph({ ts, owner: factory, sourceFile, expressionFor });
  assert.ok(!graph.blocks.some(block => block.event?.target?.text === 'this'), 'the TypeScript this parameter creates no runtime parameter write');
  assert.ok(!graph.blocks.some(block => block.node && !context.isRuntimeNode(block.node)), 'CFG operations do not execute erased subtrees');
  const runtimeHeritage = nodes.find(node => ts.isExpressionWithTypeArguments(node) && ts.isClassDeclaration(node.parent.parent));
  assert.ok(runtimeHeritage && context.isRuntimeNode(runtimeHeritage.expression), 'class extends keeps its evaluated base expression');
  const interfaceHeritage = nodes.find(node => ts.isExpressionWithTypeArguments(node) && ts.isInterfaceDeclaration(node.parent.parent));
  assert.ok(interfaceHeritage && !context.isRuntimeNode(interfaceHeritage.expression), 'interface extends stays erased');

  const slice = await collectCompilerValueSlice({ ...doc, source: doc.item.source, root: fixture.stagingRoot,
    observations: [...doc.observations, { invocation: true, node: null, signatureDeclaration: null }],
    diskAccount: fixture.state.semanticDiskAccount, context: fixture.group.context, isDefaultLibrary: fixture.group.isDefaultLibrary });
  const boundaryCoverage = slice.coverage.find(row => row.phase === 'boundaryModels');
  assert.equal(boundaryCoverage.observedCount, 2, 'the live unmodeled call and missing invocation node both remain unresolved; the erased call is excluded');
  assert.equal(boundaryCoverage.completedCount, 0);
  const partitions = [...fixture.syntaxPartitions, slice.partition], store = fixture.storeFor(partitions), edges = [], records = [];
  await validateSemanticPartitions({ store, partitions });
  for await (const row of store.iterateRows(slice.partition.partitionId, 'semantic_records')) records.push(row);
  for await (const edge of store.iterateRows(slice.partition.partitionId, 'semantic_edges')) edges.push(edge);
  const erasedRefs = new Set(erased.map(expressionFor).filter(Boolean).map(keyFor));
  assert.ok(!edges.some(edge => edge.kind === 'reads' && erasedRefs.has(keyFor(edge.to))), 'erased type names never read immutable runtime values');
  const typeOwners = new Set(nodes.filter(ts.isFunctionTypeNode).map(expressionFor).filter(Boolean).map(keyFor));
  assert.ok(!edges.some(edge => edge.kind === 'captures' && typeOwners.has(keyFor(edge.to))), 'function type syntax is not an executing closure');
  const numberDeclaration = nodes.find(node => ts.isVariableDeclaration(node) && node.name.text === 'numberValue');
  const numberValue = records.find(row => row.kind === 'value' && row.data.origin === 'definition'
    && row.span?.[0] === numberDeclaration.name.getStart(sourceFile));
  assert.ok(numberValue);
  const valueRef = { partitionId: slice.partition.partitionId, localId: numberValue.id };
  const childClass = factory.body.statements.find(ts.isClassDeclaration);
  const variable = name => nodes.find(node => ts.isVariableDeclaration(node) && node.name.text === name);
  const expectedReads = [factory.parameters[1].initializer, ...childClass.members.map(member => member.body.statements[0].expression),
    variable('snapshot').initializer.expression, variable('shorthand').initializer.properties[0].name];
  assert.equal(expectedReads.length, 5, 'actual default, wrapper, shorthand and method return uses remain');
  for (const node of expectedReads) assert.ok(edges.some(edge => edge.kind === 'reads' && keyFor(edge.from) === keyFor(valueRef)
    && keyFor(edge.to) === keyFor(expressionFor(node))), node.getText(sourceFile) + ' retains its actual runtime read');

  const declarationRef = node => {
    const anchor = node.name || node;
    return doc.item.declarations.get(anchor.getStart(sourceFile) + ':' + anchor.end)
      || (ts.isFunctionLike(node) ? expressionFor(node) : null);
  };
  const calls = collectCompilerImplicitCalls({ ts, checker, nodes, expressionFor, declarationRef });
  assert.equal(calls.length, 1, 'only the runtime class computed name invokes the actual source getter');
  assert.equal(calls[0].node.getText(sourceFile), 'holder.key');
  assert.equal(calls[0].invocationKind, 'getter');
  assert.ok(context.isRuntimeNode(calls[0].node));

  // Use the fixture's actual Program rather than a hand-built group inventory.
  const session = await createSemanticCompilerSession({ state: fixture.state, runtime: { root, buildRoot: root, semanticPolicy: fixture.policy } });
  const documents = session.prepareDocuments([]);
  const group = session.beginGroup({ ts, program: fixture.program, options: fixture.program.getCompilerOptions(), documents });
  await session.collectDocument({ ts, checker, sourceFile, nodeIndex: createTypeScriptNodeIndex(ts, sourceFile, () => null), group });
  assert.equal(group.flowDocuments.length, 1);
  assert.equal(group.flowDocuments[0].calls.filter(call => call.invocationKind === 'getter').length, 1,
    'the production compiler handoff keeps only the source-owned runtime getter candidate');
  const explicit = group.flowDocuments[0].calls.filter(call => call.invocationKind === 'call');
  assert.equal(explicit.length, 1, 'an interface computed-name call cannot become a runtime call target');
  assert.equal(explicit[0].span[0], text.lastIndexOf('makeKey()'), 'the actual runtime initializer keeps its own invocation');
  const produced = session.output().partitions, all = [...fixture.syntaxPartitions, slice.partition, ...produced];
  await validateSemanticPartitions({ store: fixture.storeFor(all), partitions: all });
  console.log('compiler runtime value/read/capture/implicit-call consumers preserve erased syntax boundaries');
} finally { await fs.rm(root, { recursive: true, force: true }); }
