import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';
import { createCompilerRuntimeContext } from '../../../src/index/semantic/compiler-runtime-context.js';
import { buildCompilerFlowGraph } from '../../../src/index/semantic/compiler-flow-graph.js';
import { collectCompilerValueSlice } from '../../../src/index/semantic/compiler-value-slice.js';
import { collectCompilerBoundaryFlow } from '../../../src/index/semantic/compiler-boundary-flow.js';
import { collectCompilerWorkerFlow } from '../../../src/index/semantic/compiler-worker-flow.js';
import { validateSemanticPartitions } from '../../../src/index/semantic/reconcile.js';

// UNVALIDATED. Compiler/checker and retained producers only; source assignment,
// timer, iterator and message operations never execute.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-pattern-reference-'));
try {
  const texts = {
    'roles.ts': `export {};
      declare function consume(...values: any[]): void;
      const immutable = 1;
      function patterns(value: any, source: any, object: any, key: any, fallback: any, iterable: any) {
        [/*write*/value] = /*read*/source;
        ({ named: /*write*/value } = /*read*/source);
        ({ /*write*/value } = /*read*/source);
        [.../*write*/value] = /*read*/source;
        ({ .../*write*/value } = /*read*/source);
        ({ [/*read*/key]: [/*write*/value = /*read*/fallback] } = /*read*/source);
        ({ nested: [/*write*/value] = /*read*/fallback } = /*read*/source);
        [((/*write*/value!))] = /*read*/source;
        for ([/*write*/value] of /*read*/iterable) {}
        for ({ named: /*write*/value } of /*read*/iterable) {}
        for ([/*write*/value] in /*read*/source) {}
        [/*read*/object[/*read*/value]] = /*read*/source;
        ({ [/*read*/key]: /*read*/object.value } = /*read*/source);
        consume([/*read*/value], { /*read*/value }, { named: /*read*/value }, [.../*read*/value], { .../*read*/value });
        delete [/*read*/value];
        delete ({ /*read*/value });
        delete ({ named: /*read*/value });
        delete ({ .../*read*/value });
        consume([/*write*/value = /*read*/fallback]);
        consume(/*read*/value += /*read*/fallback);
        /*write*/value = /*read*/fallback;
        // A const assignment throws on PutValue; it still never GetValues the target.
        [/*write*/immutable] = /*read*/source;
        return /*read*/immutable;
      }
      async function asyncPatterns(value: any, iterable: any) {
        for await ([/*write*/value] of /*read*/iterable) {}
      }
    `,
    'callbacks.ts': `export {};
      declare const source: any;
      declare function consume(value: unknown): void;
      setTimeout(function timed(payload: any) {
        [/*write*/payload] = source;
        ({ named: /*write*/payload } = source);
        ({ /*write*/payload } = source);
        consume(/*read*/payload);
      }, 0, 17);
    `,
    'node.ts': `import { MessageChannel } from 'node:worker_threads';
      declare const source: any;
      declare function consume(value: unknown): void;
      const { port1, port2 } = new MessageChannel();
      port2.on('message', function received(payload: any) {
        [/*write*/payload] = source;
        ({ named: /*write*/payload } = source);
        ({ /*write*/payload } = source);
        consume(/*read*/payload);
      });
      port1.postMessage(23);
    `
  };
  const fixture = await createCompilerBoundaryFixture(root, texts, {}, { withFlow: true });
  const key = ref => ref.partitionId + ':' + ref.localId;
  const marked = new Map();
  for (const doc of fixture.documents) {
    assert.equal(doc.sourceFile.parseDiagnostics.length, 0);
    const roles = [], context = createCompilerRuntimeContext(doc.ts);
    const indexed = new Map(doc.nodes.filter(doc.ts.isIdentifier).map(node => [node.getStart(doc.sourceFile), node]));
    for (const match of texts[doc.item.file].matchAll(/\/\*(read|write)\*\/([A-Za-z]+)/g)) {
      const start = match.index + match[0].length - match[2].length, node = indexed.get(start);
      assert.ok(node, 'every independent source marker names an actual compiler identifier');
      assert.equal(context.isLexicalValueRead(node), match[1] === 'read',
        doc.item.file + ':' + start + ' ' + match[1] + ' ' + match[2]);
      assert.equal(context.isLexicalValueRead(node), match[1] === 'read', 'cached role remains identical');
      const ref = doc.expressionFor(node);
      assert.ok(ref, 'the role has an actual retained syntax expression anchor');
      roles.push({ role: match[1], node, ref });
    }
    marked.set(doc, roles);
    // Reversing lookup order must not turn a cached aggregate role into a read.
    const reversed = createCompilerRuntimeContext(doc.ts);
    for (const { role, node } of [...roles].reverse()) assert.equal(reversed.isLexicalValueRead(node), role === 'read');
    const owners = doc.nodes.filter(node => doc.ts.isFunctionLike(node) && node.body);
    for (const owner of owners) {
      const graph = buildCompilerFlowGraph({ ts: doc.ts, owner, sourceFile: doc.sourceFile, expressionFor: doc.expressionFor });
      const writeRefs = new Set(roles.filter(value => value.role === 'write').map(value => key(value.ref)));
      assert.ok(!graph.blocks.some(block => block.event?.kind === 'read' && writeRefs.has(key(block.site))),
        'CFG target patterns never read the previous lexical value');
    }
  }
  const slices = [];
  for (const doc of fixture.documents) slices.push(await collectCompilerValueSlice({ ...doc,
    source: doc.item.source, root: fixture.stagingRoot, diskAccount: fixture.state.semanticDiskAccount,
    context: fixture.group.context, isDefaultLibrary: fixture.group.isDefaultLibrary }));
  const boundaries = await collectCompilerBoundaryFlow(fixture), workers = await collectCompilerWorkerFlow(fixture);
  const added = [...slices.map(value => value.partition), ...boundaries, ...workers];
  const partitions = [...fixture.syntaxPartitions, ...added], store = fixture.storeFor(partitions);
  await validateSemanticPartitions({ store, partitions });
  const records = new Map(), edges = [], coverage = [];
  for (const partition of partitions) {
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_records')) records.set(partition.partitionId + ':' + row.id, row);
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_edges')) edges.push(row);
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_coverage')) coverage.push(row);
  }
  for (const [doc, roles] of marked) {
    for (const { role, ref } of roles) if (role === 'write') {
      assert.ok(!edges.some(edge => edge.kind === 'reads' && key(edge.to) === key(ref)),
        'retained CFG/value-slice facts exclude lexical pattern target reads');
    }
    if (doc.item.file !== 'roles.ts') {
      const delivered = edges.filter(edge => edge.kind === 'consumes'
        && (records.get(key(edge.from))?.data.boundaryKind?.includes('callback-candidate')
          || records.get(key(edge.from))?.data.boundaryKind === 'node-worker-message-consumer-candidate'));
      for (const { role, ref } of roles) assert.equal(delivered.some(edge => key(edge.to) === key(ref)), role === 'read',
        'actual callback/Node payload projection admits value uses and excludes assignment references');
    }
  }
  const rolesDoc = fixture.documents.find(doc => doc.item.file === 'roles.ts');
  const immutableRead = marked.get(rolesDoc).find(value => value.role === 'read' && value.node.text === 'immutable');
  assert.ok(edges.some(edge => edge.kind === 'reads' && key(edge.to) === key(immutableRead.ref)),
    'the immutable slice still retains its ordinary source value read');
  assert.ok(coverage.some(row => row.reason?.includes('destructuring_write_requires_pattern_analysis')));
  assert.ok(coverage.filter(row => row.phase === 'boundaryModels').every(row => row.state === 'partial'));
  console.log('Compiler pattern targets stay references across CFG, value slice and payload-use consumers');
} finally { await fs.rm(root, { recursive: true, force: true }); }
