import fs from 'node:fs/promises';
import path from 'node:path';
import { enqueueGraphRelationsArtifacts } from '../../../src/index/build/artifacts/graph-relations.js';

export const buildRelationBenchChunks = ({
  chunkCount = 10000,
  edgesPerChunk = 2,
  fileModulo = 250,
  edgeCountForChunk = null
} = {}) => {
  const chunks = new Array(chunkCount);
  for (let i = 0; i < chunkCount; i += 1) {
    const file = `src/file-${String(i % fileModulo).padStart(3, '0')}.js`;
    const uid = `u${i}`;
    const callDetails = [];
    const edgeCount = typeof edgeCountForChunk === 'function'
      ? edgeCountForChunk(i)
      : edgesPerChunk;
    for (let j = 1; j <= edgeCount; j += 1) {
      callDetails.push({ targetChunkUid: `u${(i + j) % chunkCount}` });
    }
    chunks[i] = {
      file,
      ext: '.js',
      name: `sym${i}`,
      kind: 'FunctionDeclaration',
      chunkUid: uid,
      metaV2: {
        chunkUid: uid,
        lang: 'javascript',
        effective: { languageId: 'javascript' },
        symbol: { symbolId: `sym-${i}` }
      },
      codeRelations: { callDetails }
    };
  }
  return chunks;
};

export const buildRelationBenchFileRelations = () => new Map([
  ['src/file-000.js', { importLinks: ['src/file-001.js'] }],
  ['src/file-001.js', { importLinks: ['src/file-000.js'] }]
]);

export const formatRelationBenchArtifactLabel = (outDir, filePath) => (
  path.relative(outDir, filePath).split(path.sep).join('/')
);

export const removeRelationBenchArtifact = async (targetPath) => {
  await fs.rm(targetPath, { recursive: true, force: true }).catch(() => {});
};

export const writeRelationBenchGraphArtifacts = async ({
  outDir,
  chunks,
  fileRelations,
  maxJsonBytes,
  onPiece = null
}) => {
  const formatArtifactLabel = (filePath) => formatRelationBenchArtifactLabel(outDir, filePath);
  await enqueueGraphRelationsArtifacts({
    graphRelations: null,
    chunks,
    fileRelations,
    callSites: null,
    caps: null,
    outDir,
    maxJsonBytes,
    byteBudget: null,
    log: null,
    enqueueWrite: () => {
      throw new Error('enqueueWrite should not be called by streaming graph_relations build');
    },
    addPieceFile: (entry, filePath) => {
      if (typeof onPiece === 'function') onPiece(entry, filePath, formatArtifactLabel(filePath));
    },
    formatArtifactLabel,
    removeArtifact: removeRelationBenchArtifact,
    stageCheckpoints: null
  });
};
