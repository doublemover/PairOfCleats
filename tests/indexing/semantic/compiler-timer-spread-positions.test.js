import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';
import { collectCompilerBoundaryFlow } from '../../../src/index/semantic/compiler-boundary-flow.js';

const text = `export {};
  declare const unknownValues: unknown[]; declare const secret: unknown;
  declare function consume(value: unknown): void;
  setTimeout(function empty(first: unknown) { consume(first); }, 0, ...[], secret);
  setTimeout(function one(first: unknown, second: unknown) { consume(second); }, 0, ...[1], secret);
  setTimeout(function two(first: unknown, second: unknown, third: unknown) { consume(third); }, 0, ...[1,2], secret);
  setTimeout(function unknown(first: unknown, second: unknown) { consume(second); }, 0, ...unknownValues, secret);
  setTimeout(function prefix(first: unknown, second: unknown) { consume(first); consume(second); }, 0, secret, ...unknownValues, secret);
  setTimeout(function ordinary(first: unknown) { consume(first); }, 0, secret);
`;
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-timer-positions-'));
try {
  const fixture = await createCompilerBoundaryFixture(root, { 'timer.ts': text });
  const partitions = await collectCompilerBoundaryFlow(fixture), store = fixture.storeFor([...fixture.syntaxPartitions, ...partitions]);
  const key = ref => ref.partitionId + ':' + ref.localId, doc = fixture.documents[0], ts = doc.ts;
  const records = new Map(), edges = [], coverage = [];
  for (const partition of [...fixture.syntaxPartitions, ...partitions]) {
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_records')) records.set(key({ partitionId: partition.partitionId, localId: row.id }), row);
    for await (const row of store.iterateRows(partition.partitionId, 'semantic_edges')) edges.push(row);
    if (partitions.includes(partition)) for await (const row of store.iterateRows(partition.partitionId, 'semantic_coverage')) coverage.push(row);
  }
  for (const [handlerName, expected] of [['empty', true], ['one', true], ['two', true], ['unknown', false], ['ordinary', true]]) {
    const handler = doc.nodes.find(node => ts.isFunctionExpression(node) && node.name?.text === handlerName);
    const use = doc.nodes.find(node => ts.isIdentifier(node) && ts.isCallExpression(node.parent)
      && node.pos >= handler.pos && node.end <= handler.end && ['first', 'second', 'third'].includes(node.text));
    const consumed = edges.some(edge => edge.kind === 'consumes' && key(edge.to) === key(doc.expressionFor(use))
      && records.get(key(edge.from))?.data?.modelId?.includes('callback-candidate'));
    assert.equal(consumed, expected, handlerName + ' payload must own its justified runtime ordinal');
  }
  assert.ok(coverage.some(row => row.reason?.includes('callback_payload_argument_frontier_incomplete')));
  assert.ok(coverage.every(row => row.phase !== 'boundaryModels' || row.state === 'partial'), 'no timer activation is proved or executed');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('compiler timer payloads use shared known-expansion positions and stop at unknown spread frontiers');
