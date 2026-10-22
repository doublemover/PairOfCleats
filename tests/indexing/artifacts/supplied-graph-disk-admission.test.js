import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { enqueueGraphRelationsArtifacts } from '../../../src/index/build/artifacts/graph-relations.js';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-supplied-graph-disk-'));
const physicalBytes = async directory => {
  let bytes = 0;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    bytes += entry.isDirectory() ? await physicalBytes(filename) : (await fs.stat(filename)).size;
  }
  return bytes;
};
const graphRelations = { version: 2, generatedAt: '2026-10-22T00:00:00.000Z',
  callGraph: { nodeCount: 40, edgeCount: 40, nodes: Array.from({ length: 40 }, (_, id) => ({ id: 'node-' + id,
    file: 'file-' + id + '.js', name: 'function-' + id, out: ['node-' + (id + 1) % 40], in: ['node-' + (id + 39) % 40],
    fixtureVector: new Uint8Array([1, 2]) })) },
  usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }, importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] } };
const enqueue = async options => {
  const tasks = [], pieces = [];
  await enqueueGraphRelationsArtifacts({ graphRelations, log() {},
    enqueueWrite: (_label, write) => tasks.push(write), addPieceFile: (entry, filename) => pieces.push({ ...entry, filename }),
    formatArtifactLabel: value => value, ...options });
  return { pieces, async run() { for (const task of tasks) await task(); } };
};
try {
  const compact = path.join(root, 'compact'); await fs.mkdir(compact);
  const owner = createSemanticDiskAccount(4 * 1024 * 1024);
  const first = await enqueue({ outDir: compact, maxJsonBytes: 1024 * 1024, diskAccount: owner }); await first.run();
  assert.equal(owner.used, await physicalBytes(compact));
  const filename = path.join(compact, 'graph_relations.json'), original = await fs.readFile(filename);
  assert.deepEqual(JSON.parse(original).callGraph.nodes[0].fixtureVector, [1, 2], 'disk admission preserves existing JSON encoder meaning');
  const bounded = createSemanticDiskAccount(original.length * 3 - 1); bounded.reserve(original.length);
  const overlap = await enqueue({ outDir: compact, maxJsonBytes: 1024 * 1024, diskAccount: bounded });
  await assert.rejects(overlap.run(), { code: 'ERR_SEMANTIC_DISK_LIMIT' }, 'prior output plus a possible atomic copy require simultaneous credits');
  assert.equal(bounded.used, original.length); assert.deepEqual(await fs.readFile(filename), original);
  const repeated = await enqueue({ outDir: compact, maxJsonBytes: 1024 * 1024, diskAccount: owner }); await repeated.run();
  assert.equal(owner.used, await physicalBytes(compact), 'compact replacement retires only its prior physical bytes');

  const sharded = path.join(root, 'sharded'); await fs.mkdir(sharded);
  const shardOwner = createSemanticDiskAccount(4 * 1024 * 1024);
  const writeShards = async () => { const queued = await enqueue({ outDir: sharded, maxJsonBytes: 1024, diskAccount: shardOwner }); await queued.run(); return queued; };
  const shards = await writeShards();
  assert.ok(shards.pieces.some(piece => piece.name === 'graph_relations_offsets'));
  assert.ok(shards.pieces.some(piece => piece.name === 'graph_relations_csr'));
  assert.equal(shardOwner.used, await physicalBytes(sharded), 'display rows, offsets, metadata and legacy CSR share one account');
  await writeShards();
  assert.equal(shardOwner.used, await physicalBytes(sharded), 'shard and CSR replacement returns exact retired credits');
  const quota = path.join(root, 'quota'); await fs.mkdir(quota);
  const denied = await enqueue({ outDir: quota, maxJsonBytes: 1024 * 1024, diskLimit: 1 });
  await assert.rejects(denied.run(), { code: 'ERR_SEMANTIC_DISK_LIMIT' });
  assert.equal(await physicalBytes(quota), 0);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('supplied graph compact/sharded/CSR shared disk admission controls passed');
