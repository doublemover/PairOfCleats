#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { enqueueGraphRelationsArtifacts } from '../../../src/index/build/artifacts/graph-relations.js';
import { loadGraphRelationsSync, readJsonFile } from '../../../src/shared/artifact-io.js';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const cacheRoot = resolveTestCachePath(root, 'relations-memory-budget');
const outDir = path.join(cacheRoot, 'index-code');

await fs.rm(cacheRoot, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const buildChunks = ({ chunkCount = 50, fanout = 10 } = {}) => {
  const chunks = new Array(chunkCount);
  const callSites = [];
  for (let i = 0; i < chunkCount; i += 1) {
    const uid = `u${i}`;
    const file = `src/file-${String(i % 5).padStart(3, '0')}.js`;
    chunks[i] = {
      chunkUid: uid,
      file,
      ext: '.js',
      name: `sym${i}`,
      kind: 'FunctionDeclaration',
      metaV2: {
        chunkUid: uid,
        lang: 'javascript',
        effective: { languageId: 'javascript' },
        symbol: { symbolId: `sym-${i}` }
      },
      codeRelations: {}
    };
  }
  for (let i = 0; i < chunkCount; i += 1) {
    for (let j = 1; j <= fanout; j += 1) {
      callSites.push({
        callerChunkUid: `u${i}`,
        targetChunkUid: `u${(i + j) % chunkCount}`
      });
    }
  }
  return { chunks, callSites };
};

const buildFileRelations = () => new Map([
  ['src/file-000.js', { importLinks: ['src/file-001.js'] }],
  ['src/file-001.js', { importLinks: ['src/file-000.js'] }]
]);

const writeManifest = async (pieces) => {
  const piecesDir = path.join(outDir, 'pieces');
  await fs.mkdir(piecesDir, { recursive: true });
  await fs.writeFile(
    path.join(piecesDir, 'manifest.json'),
    JSON.stringify({
      version: 2,
      generatedAt: new Date().toISOString(),
      mode: 'code',
      stage: 'stage2',
      pieces
    }, null, 2)
  );
};

const { chunks, callSites } = buildChunks({ chunkCount: 80, fanout: 10 });
const fileRelations = buildFileRelations();
const pieces = [];
const toPosix = (value) => value.split(path.sep).join('/');
const formatArtifactLabel = (filePath) => toPosix(path.relative(outDir, filePath));
const addPieceFile = (entry, filePath) => {
  pieces.push({ ...entry, path: formatArtifactLabel(filePath) });
};
const removeArtifact = async (targetPath) => {
  await fs.rm(targetPath, { recursive: true, force: true }).catch(() => {});
};

await enqueueGraphRelationsArtifacts({
  graphRelations: null,
  chunks,
  fileRelations,
  callSites,
  caps: null,
  outDir,
  maxJsonBytes: 16 * 1024,
  byteBudget: { maxBytes: 4096, overflow: 'drop' },
  log: null,
  enqueueWrite: () => {
    throw new Error('enqueueWrite should not be called by streaming graph_relations build');
  },
  addPieceFile,
  formatArtifactLabel,
  removeArtifact,
  stageCheckpoints: null
});

await writeManifest(pieces);

const metaRaw = readJsonFile(path.join(outDir, 'graph_relations.meta.json'), { maxBytes: 1024 * 1024 });
const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
const byteCaps = meta?.extensions?.byteCaps || null;
if (!byteCaps || byteCaps.truncated !== true) {
  console.error('relations memory budget test failed: expected meta.extensions.byteCaps.truncated=true.');
  process.exit(1);
}
if (!Number.isFinite(byteCaps.droppedRows) || byteCaps.droppedRows <= 0) {
  console.error('relations memory budget test failed: expected meta.extensions.byteCaps.droppedRows > 0.');
  process.exit(1);
}

const payload = loadGraphRelationsSync(outDir);
if (!payload?.callGraph || !payload?.usageGraph || !payload?.importGraph) {
  console.error('relations memory budget test failed: expected graph_relations payload to be loadable.');
  process.exit(1);
}

console.log('relations memory budget test passed');

