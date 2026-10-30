import assert from 'node:assert/strict';
import { collectCompilerWorkerFlow } from '../../../src/index/semantic/compiler-worker-flow.js';
import { createCompilerPlatformSourceFixture } from '../../helpers/compiler-platform-source-fixture.js';

const cases = [
  { name: 'array', argument: '[bufferA,channel.port2]', supported: true },
  { name: 'options', argument: '{transfer:[bufferA,channel.port2]}', supported: true },
  { name: 'spread', argument: '{transfer:[bufferA,channel.port2],...{transfer:[bufferB,other.port2]}}', reason: 'options_spread' },
  { name: 'duplicate', argument: '{transfer:[bufferA,channel.port2],transfer:[bufferB,other.port2]}', reason: 'duplicate_property' },
  { name: 'unknown', argument: '{transfer:[bufferA,channel.port2],...unknown}', reason: 'options_spread' },
  { name: 'absent', argument: '{}' }
];
const texts = {};
for (const item of cases) {
  texts[`${item.name}.ts`] = `export {}; const worker = new Worker(new URL('./${item.name}-worker.ts',import.meta.url));
    const channel = new MessageChannel(), other = new MessageChannel();
    const bufferA = new ArrayBuffer(4), bufferB = new ArrayBuffer(4); declare const unknown: any;
    channel.port1.onmessage = event => console.log(event.data);
    worker.postMessage({port:channel.port2},${item.argument});`;
  texts[`${item.name}-worker.ts`] = `export {}; declare const self: DedicatedWorkerGlobalScope;
    self.onmessage = event => event.ports[0].postMessage(${JSON.stringify(item.name)});`;
}
const fixture = await createCompilerPlatformSourceFixture(texts);
try {
  const partitions = await collectCompilerWorkerFlow(fixture), { records, edges, coverage } = await fixture.read(partitions);
  const refKey = ref => `${ref.partitionId}:${ref.localId}`;
  const sourceId = file => fixture.documents.find(doc => doc.item.file === file).item.source.sourceUnitId;
  for (const item of cases) {
    const sender = `${item.name}.ts`, receiver = `${item.name}-worker.ts`, senderId = sourceId(sender);
    const transfers = edges.filter(edge => edge.kind === 'transfers'
      && records.get(refKey(edge.to))?.row.data?.boundaryKind === 'worker-transfer-request'
      && records.get(refKey(edge.from))?.partition.sourceUnitId === senderId);
    const sources = transfers.map(edge => texts[sender].slice(...records.get(refKey(edge.from)).row.span)).sort();
    assert.deepEqual(sources, item.supported ? ['bufferA', 'channel.port2'] : [], `${sender}: no overwritten first transfer list`);
    const forwarded = edges.some(edge => edge.kind === 'dispatches'
      && records.get(refKey(edge.from))?.row.data?.boundaryKind === 'message-port-dispatch-request'
      && records.get(refKey(edge.from))?.partition.sourceUnitId === sourceId(receiver)
      && records.get(refKey(edge.to))?.partition.sourceUnitId === senderId);
    assert.equal(forwarded, Boolean(item.supported), `${sender}: port identity and emitted request use the same qualified choice`);
    if (item.reason) {
      const reason = coverage.filter(row => row.scope.sourceUnitId === senderId).map(row => row.reason).join(';');
      assert.ok(reason.includes('worker_transfer_' + item.reason));
      assert.ok(reason.includes('browser_port_transfer_' + item.reason));
    }
  }
  assert.ok(coverage.every(row => row.state === 'partial'));
  const repeated = await collectCompilerWorkerFlow({ ...fixture, group: { ...fixture.group, workerDocuments: [...fixture.documents].reverse() } });
  assert.deepEqual(repeated.map(row => row.canonicalHash).sort(), partitions.map(row => row.canonicalHash).sort());
} finally { await fixture.cleanup(); }
console.log('Actual worker request and browser port consumers agree on supported, overwritten, unknown and absent transfer options.');
