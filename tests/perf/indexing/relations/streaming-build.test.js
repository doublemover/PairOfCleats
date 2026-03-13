#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { stableStringify } from '../../../../src/shared/stable-json.js';
import { loadGraphRelationsSync } from '../../../../src/shared/artifact-io.js';
import { enqueueGraphRelationsArtifacts } from '../../../../src/index/build/artifacts/graph-relations.js';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';

const root = process.cwd();
const cacheRoot = resolveTestCachePath(root, 'relations-streaming-build');
const outA = path.join(cacheRoot, 'a');
const outB = path.join(cacheRoot, 'b');

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(outA, { recursive: true });
await fsPromises.mkdir(outB, { recursive: true });

const buildChunks = (order = 'forward') => {
  const chunks = [
    {
      chunkUid: 'u1',
      file: 'src/a.js',
      name: 'A',
      kind: 'function',
      metaV2: { symbol: { symbolId: 'sym-a' } },
      codeRelations: {
        callLinks: [
          { to: { status: 'resolved', resolved: { chunkUid: 'u2' } } }
        ],
        usageLinks: [],
        callDetails: [
          { targetChunkUid: 'u2' }
        ]
      }
    },
    {
      chunkUid: 'u2',
      file: 'src/b.js',
      name: 'B',
      kind: 'function',
      metaV2: { symbol: { symbolId: 'sym-b' } },
      codeRelations: {
        callLinks: [],
        usageLinks: [
          { to: { status: 'resolved', resolved: { chunkUid: 'u1' } } }
        ],
        callDetails: []
      }
    }
  ];
  return order === 'reverse' ? chunks.slice().reverse() : chunks;
};

const buildFileRelations = () => new Map([
  ['src/a.js', { importLinks: ['src/b.js'] }],
  ['src/b.js', { importLinks: [] }]
]);

const writeManifest = async (outDir, pieces) => {
  const piecesDir = path.join(outDir, 'pieces');
  await fsPromises.mkdir(piecesDir, { recursive: true });
  const manifestPath = path.join(piecesDir, 'manifest.json');
  await fsPromises.writeFile(manifestPath, JSON.stringify({
    version: 2,
    generatedAt: new Date().toISOString(),
    mode: 'code',
    stage: 'stage2',
    pieces
  }, null, 2));
};

const runBuild = async (outDir, { chunks, fileRelations }) => {
  const pieces = [];
  const toPosix = (value) => value.split(path.sep).join('/');
  const formatArtifactLabel = (filePath) => toPosix(path.relative(outDir, filePath));
  const addPieceFile = (entry, filePath) => {
    pieces.push({ ...entry, path: formatArtifactLabel(filePath) });
  };
  const removeArtifact = async (targetPath) => {
    await fsPromises.rm(targetPath, { recursive: true, force: true }).catch(() => {});
  };

  const ordering = await enqueueGraphRelationsArtifacts({
    graphRelations: null,
    chunks,
    fileRelations,
    caps: null,
    outDir,
    maxJsonBytes: 64 * 1024,
    byteBudget: null,
    log: null,
    enqueueWrite: () => {
      throw new Error('enqueueWrite should not be called by streaming graph_relations build');
    },
    addPieceFile,
    formatArtifactLabel: formatArtifactLabel,
    removeArtifact,
    stageCheckpoints: null
  });

  await writeManifest(outDir, pieces);
  return { ordering, pieces };
};

const buildA = await runBuild(outA, { chunks: buildChunks('forward'), fileRelations: buildFileRelations() });
const buildB = await runBuild(outB, { chunks: buildChunks('reverse'), fileRelations: buildFileRelations() });

if (!buildA.ordering?.orderingHash || buildA.ordering.orderingCount !== 6) {
  console.error('Expected graph_relations ordering hash/count.');
  process.exit(1);
}

const graphA = loadGraphRelationsSync(outA);
const graphB = loadGraphRelationsSync(outB);
delete graphA.generatedAt;
delete graphB.generatedAt;

if (stableStringify(graphA) !== stableStringify(graphB)) {
  console.error('graph_relations streaming build is not deterministic.');
  process.exit(1);
}

const callNodes = graphA?.callGraph?.nodes || [];
const usageNodes = graphA?.usageGraph?.nodes || [];
const importNodes = graphA?.importGraph?.nodes || [];
if (callNodes.length !== 2 || usageNodes.length !== 2 || importNodes.length !== 2) {
  console.error('graph_relations node counts mismatch.');
  process.exit(1);
}

const byId = (nodes) => new Map(nodes.map((node) => [node.id, node]));
const callById = byId(callNodes);
const usageById = byId(usageNodes);
const importById = byId(importNodes);

if ((callById.get('u1')?.out || []).join(',') !== 'u2') {
  console.error('callGraph missing u1 -> u2 edge.');
  process.exit(1);
}
if ((callById.get('u2')?.in || []).join(',') !== 'u1') {
  console.error('callGraph missing u2 <- u1 edge.');
  process.exit(1);
}
if ((usageById.get('u2')?.out || []).join(',') !== 'u1') {
  console.error('usageGraph missing u2 -> u1 edge.');
  process.exit(1);
}
if ((importById.get('src/a.js')?.out || []).join(',') !== 'src/b.js') {
  console.error('importGraph missing src/a.js -> src/b.js edge.');
  process.exit(1);
}

if (fs.existsSync(path.join(outA, 'graph_relations.json'))) {
  console.error('streaming graph_relations should not write graph_relations.json');
  process.exit(1);
}
if (!fs.existsSync(path.join(outA, 'graph_relations.meta.json'))) {
  console.error('Missing graph_relations.meta.json');
  process.exit(1);
}
if (!fs.existsSync(path.join(outA, 'graph_relations.parts'))) {
  console.error('Missing graph_relations.parts');
  process.exit(1);
}

console.log('relations streaming build test passed');

