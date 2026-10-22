import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';
import { collectCompilerBoundaryFlow } from '../../../src/index/semantic/compiler-boundary-flow.js';
import { collectCompilerWorkerFlow } from '../../../src/index/semantic/compiler-worker-flow.js';
import { validateSemanticPartitions } from '../../../src/index/semantic/reconcile.js';

// Authored only: no callback, timer, Promise, channel or message is run.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-callback-runtime-'));
try {
  const texts = {
    'callbacks.ts': `export {};
      declare function consume(value: unknown): void;
      setTimeout(function timed(this: unknown, first: number, second: string) {
        type ErasedFirst = typeof first;
        consume(first); consume(second);
      }, 0, 7, 'second');
      Promise.resolve(8).then(function settled(this: unknown, value: number) {
        type ErasedValue = typeof value;
        return value;
      });
      setTimeout(function rest(this: unknown, ...values: unknown[]) { consume(values); }, 0, 9);
    `,
    'node.ts': `import { MessageChannel, type MessagePort } from 'node:worker_threads';
      declare function consume(value: unknown): void;
      const { port1, port2 } = new MessageChannel();
      port2.on('message', function received(this: MessagePort, payload: unknown) {
        type ErasedPayload = typeof payload;
        consume(payload);
      });
      port2.on('message', function rest(...values: unknown[]) { consume(values); });
      port1.postMessage(10);
    `,
    'browser.ts': `export {};
      declare function consume(value: unknown): void;
      const channel = new MessageChannel();
      channel.port2.onmessage = function received(this: MessagePort, event: MessageEvent) { consume(event.data); };
      channel.port2.addEventListener('message', function listening(this: MessagePort, event: MessageEvent) { consume(event.data); });
      channel.port2.addEventListener('message', function rest(...events: MessageEvent[]) { consume(events); });
      channel.port1.postMessage(11);
    `
  };
  const fixture = await createCompilerBoundaryFixture(root, texts);
  for (const doc of fixture.documents) assert.equal(doc.sourceFile.parseDiagnostics.length, 0);
  const boundary = await collectCompilerBoundaryFlow(fixture), workers = await collectCompilerWorkerFlow(fixture);
  const partitions = [...fixture.syntaxPartitions, ...boundary, ...workers], store = fixture.storeFor(partitions);
  await validateSemanticPartitions({ store, partitions });
  const key = ref => ref.partitionId + ':' + ref.localId, records = new Map(), edges = [], coverage = [];
  for (const partition of partitions) {
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_records')) records.set(partition.partitionId + ':' + row.id, { row, partition });
    for await (const edge of store.iterateRows(partition.partitionId, 'semantic_edges')) edges.push(edge);
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_coverage')) coverage.push(row);
  }
  const kind = ref => records.get(key(ref))?.row.data.boundaryKind;
  const consumerEdges = edges.filter(edge => edge.kind === 'consumes' && kind(edge.from)?.includes('callback-candidate')
    || edge.kind === 'consumes' && ['node-worker-message-consumer-candidate', 'message-port-consumer-candidate'].includes(kind(edge.from)));
  const docFor = file => fixture.documents.find(doc => doc.item.file === file);
  const uses = (file, predicate) => {
    const doc = docFor(file);
    return doc.nodes.filter(node => predicate(doc.ts, node)).map(doc.expressionFor).filter(Boolean);
  };
  const hasConsumer = ref => consumerEdges.some(edge => key(edge.to) === key(ref));
  for (const name of ['first', 'second', 'value']) {
    const actual = uses('callbacks.ts', (ts, node) => ts.isIdentifier(node) && node.text === name
      && (ts.isCallExpression(node.parent) || ts.isReturnStatement(node.parent)));
    assert.ok(actual.length > 0 && actual.every(hasConsumer), name + ' uses receive the correct post-this runtime payload');
  }
  const nodePayload = uses('node.ts', (ts, node) => ts.isIdentifier(node) && node.text === 'payload' && ts.isCallExpression(node.parent));
  assert.equal(nodePayload.length, 1);
  assert.ok(nodePayload.every(hasConsumer), 'Node message payload is direct runtime argument zero after erased this');
  const browserData = uses('browser.ts', (ts, node) => ts.isPropertyAccessExpression(node) && node.getText(docFor('browser.ts').sourceFile) === 'event.data');
  assert.equal(browserData.length, 2);
  assert.ok(browserData.every(hasConsumer), 'both browser message registration forms keep runtime event.data consumers');
  for (const file of ['callbacks.ts', 'node.ts']) {
    const erased = uses(file, (ts, node) => ts.isIdentifier(node) && (ts.isTypeQueryNode(node.parent) || ts.isParameter(node.parent)));
    assert.ok(erased.every(ref => !hasConsumer(ref)), 'type-only/parameter declaration references cannot acquire runtime payload-use edges');
  }
  const restUses = fixture.documents.flatMap(doc => doc.nodes.filter(node => doc.ts.isIdentifier(node)
    && ['values', 'events'].includes(node.text) && doc.ts.isCallExpression(node.parent)).map(doc.expressionFor).filter(Boolean));
  assert.ok(restUses.length > 0 && restUses.every(ref => !hasConsumer(ref)), 'a rest array is not one direct delivered payload');
  assert.ok(coverage.some(row => row.reason?.includes('callback_payload_parameter_mapping_unresolved')));
  assert.ok(coverage.some(row => row.reason?.includes('node_worker_message_binding_pattern_unresolved')));
  assert.ok(coverage.some(row => row.reason?.includes('message_parameter_binding_pattern_unsupported')));
  assert.ok(coverage.every(row => row.phase !== 'boundaryModels' || row.state === 'partial'));
  console.log('platform callback runtime parameters and erased-use ownership controls passed');
} finally { await fs.rm(root, { recursive: true, force: true }); }
