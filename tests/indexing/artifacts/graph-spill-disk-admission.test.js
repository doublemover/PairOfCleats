import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { enqueueGraphRelationsArtifacts } from '../../../src/index/build/artifacts/graph-relations.js';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-graph-spill-account-'));
const chunks = Array.from({ length: 80 }, (_, id) => ({ id, chunkUid: 'chunk-' + id,
  file: 'file-' + id + '.js', name: 'function' + id, kind: 'function', codeRelations: {} }));
for (const chunk of chunks) chunk.codeRelations.callLinks = chunks.map(target => ({
  to: { status: 'resolved', resolved: { chunkUid: target.chunkUid } }
}));
const actualBytes = async directory => {
  let bytes = 0;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    bytes += entry.isDirectory() ? await actualBytes(file) : (await fs.stat(file)).size;
  }
  return bytes;
};
try {
  const quotaRoot = path.join(root, 'quota'); await fs.mkdir(quotaRoot);
  await assert.rejects(enqueueGraphRelationsArtifacts({ chunks, outDir: quotaRoot, maxJsonBytes: 16384,
    diskLimit: 1, addPieceFile() {}, formatArtifactLabel: value => value }), { code: 'ERR_SEMANTIC_DISK_LIMIT' });
  await assert.rejects(fs.stat(path.join(quotaRoot, 'graph_relation_edges.meta.json')), { code: 'ENOENT' },
    'the first raw spill must acquire disk credits before any retained adjacency publication');
  const outDir = path.join(root, 'output'); await fs.mkdir(outDir);
  const account = createSemanticDiskAccount(32 * 1024 * 1024);
  const pieces = [];
  await enqueueGraphRelationsArtifacts({ chunks, outDir, maxJsonBytes: 16384, diskAccount: account,
    caps: { maxNodes: 4, maxEdges: 2 }, addPieceFile: (entry, file) => pieces.push({ ...entry, file }),
    formatArtifactLabel: value => value });
  const count = pieces.filter(piece => piece.name === 'graph_relation_edges').reduce((sum, piece) => sum + piece.count, 0);
  assert.equal(count, 6400, 'disk accounting cannot apply display caps to the canonical retained edge set');
  assert.equal(account.used, await actualBytes(outDir), 'raw/selected spills retire, retained/display shards and metadata remain charged');
  await assert.rejects(fs.stat(path.join(outDir, 'graph_relations.staging')), { code: 'ENOENT' });
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('graph spill quota admission and final physical-inventory controls passed');
