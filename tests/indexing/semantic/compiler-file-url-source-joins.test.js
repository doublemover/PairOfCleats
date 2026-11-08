import assert from 'node:assert/strict';
import { collectCompilerBoundaryFlow } from '../../../src/index/semantic/compiler-boundary-flow.js';
import { collectCompilerWorkerFlow } from '../../../src/index/semantic/compiler-worker-flow.js';
import { createCompilerPlatformSourceFixture } from '../../helpers/compiler-platform-source-fixture.js';

const cases = [
  ['./%63hild.ts', 'child.ts'], ['./%2563hild.ts', '%63hild.ts'], ['./space%20name.ts', 'space name.ts'],
  ['./caf%C3%A9.ts', 'café.ts'], ['./percent%25.ts', 'percent%.ts'], ['./folder/%2e%2e/child.ts', 'child.ts'], ['./child.ts', 'child.ts']
];
const texts = Object.fromEntries([...new Set(cases.map(([, file]) => file))].map(file => [file,
  'export {}; declare const self: DedicatedWorkerGlobalScope; self.addEventListener("message", event => console.log(event.data)); process.on("message", value => console.log(value));']));
for (const [index, [literal]] of cases.entries()) {
  texts[`fork-${index}.ts`] = `import {fork} from 'node:child_process'; const child = fork(new URL(${JSON.stringify(literal)}, import.meta.url)); child.send(${index});`;
  texts[`browser-${index}.ts`] = `export {}; const worker = new Worker(new URL(${JSON.stringify(literal)}, import.meta.url), {type:'module'}); worker.postMessage(${index});`;
}
texts['node-ordinary.ts'] = 'import {Worker} from "node:worker_threads"; const worker = new Worker(new URL("./child.ts", import.meta.url), {}); worker.postMessage(1);';
texts['node-percent.ts'] = 'import {Worker} from "node:worker_threads"; const worker = new Worker(new URL("./%63hild.ts", import.meta.url), {}); worker.postMessage(2);';
const fixture = await createCompilerPlatformSourceFixture(texts);
try {
  const forkParts = await collectCompilerBoundaryFlow(fixture), workerParts = await collectCompilerWorkerFlow(fixture);
  const fork = await fixture.read(forkParts), workers = await fixture.read(workerParts);
  const refKey = ref => `${ref.partitionId}:${ref.localId}`;
  const sourceId = file => fixture.documents.find(doc => doc.item.file === file).item.source.sourceUnitId;
  for (const [index, [, target]] of cases.entries()) {
    for (const [prefix, graph, kind] of [['fork', fork, 'process-ipc-consumer-source-callback-candidate'],
      ['browser', workers, 'worker-message-dispatch-request']]) {
      const sender = `${prefix}-${index}.ts`, invocationText = prefix === 'fork' ? `child.send(${index})` : `worker.postMessage(${index})`;
      const candidates = [...graph.records.values()].filter(({ row, partition }) => {
        if (partition.sourceUnitId !== sourceId(sender) || row.data?.boundaryKind !== kind || !row.data.invocation) return false;
        const invocation = graph.records.get(refKey(row.data.invocation))?.row;
        return invocation?.span && texts[sender].slice(...invocation.span) === invocationText;
      });
      assert.equal(candidates.length, 1, `${sender}: exact invocation source witness`);
      assert.equal(candidates[0].row.data.toContext, 'source:' + sourceId(target), `${sender}: selected decoded source, never raw URL spelling`);
      if (prefix === 'browser') {
        const dispatch = { partitionId: candidates[0].partition.partitionId, localId: candidates[0].row.id };
        assert.ok(graph.edges.some(edge => edge.kind === 'dispatches' && refKey(edge.from) === refKey(dispatch)
          && graph.records.get(refKey(edge.to))?.partition.sourceUnitId === sourceId(target)), 'browser candidate reaches the selected retained consumer');
      }
    }
  }
  for (const [file, expected] of [['node-ordinary.ts', 'source:' + sourceId('child.ts')], ['node-percent.ts', null]]) {
    const row = [...workers.records.values()].find(value => value.partition.sourceUnitId === sourceId(file)
      && value.row.data?.boundaryKind === 'node-worker-construction-request');
    assert.ok(row); assert.equal(row.row.data.toContext, expected, 'Node workers retain their narrower percent-escape admission');
  }
  assert.ok([...fork.coverage, ...workers.coverage].every(row => row.state === 'partial'));
  const repeated = await collectCompilerWorkerFlow({ ...fixture, group: { ...fixture.group, workerDocuments: [...fixture.documents].reverse() } });
  assert.deepEqual(repeated.map(row => row.canonicalHash).sort(), workerParts.map(row => row.canonicalHash).sort());
} finally { await fixture.cleanup(); }
console.log('Compiler-qualified fork/browser URL joins preserve decoded source refs; conservative Node-worker qualification remains separate.');
