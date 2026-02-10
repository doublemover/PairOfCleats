import { enqueueSymbolsArtifacts } from '../../../../../src/index/build/artifacts/writers/symbols.js';
import { enqueueSymbolOccurrencesArtifacts } from '../../../../../src/index/build/artifacts/writers/symbol-occurrences.js';
import { enqueueSymbolEdgesArtifacts } from '../../../../../src/index/build/artifacts/writers/symbol-edges.js';
import { buildFileMeta } from '../../../../../src/index/build/artifacts/file-meta.js';

const makeSymbol = (name, uid, file) => ({
  scheme: 'poc',
  symbolId: `sym:${uid}`,
  scopedId: `scope:${uid}`,
  symbolKey: `symkey:${name}`,
  qualifiedName: name,
  kindGroup: 'function',
  chunkUid: uid,
  languageId: 'javascript',
  file
});

const makeRef = (name, uid) => ({
  v: 1,
  targetName: name,
  kindHint: null,
  importHint: null,
  candidates: [
    {
      symbolId: `sym:${uid}`,
      chunkUid: uid,
      symbolKey: `symkey:${name}`,
      signatureKey: null,
      kindGroup: 'function'
    }
  ],
  status: 'resolved',
  resolved: { symbolId: `sym:${uid}`, chunkUid: uid }
});

export const createSymbolArtifactChunks = () => ([
  {
    file: 'src/alpha.js',
    name: 'alpha',
    kind: 'function',
    chunkUid: 'uid-alpha',
    metaV2: {
      file: 'src/alpha.js',
      virtualPath: 'src/alpha.js',
      chunkUid: 'uid-alpha',
      symbol: makeSymbol('alpha', 'uid-alpha', 'src/alpha.js')
    },
    codeRelations: {
      callLinks: [
        {
          v: 1,
          edgeKind: 'call',
          fromChunkUid: 'uid-alpha',
          to: makeRef('beta', 'uid-beta')
        }
      ],
      callDetails: [
        {
          callee: 'beta',
          calleeRef: makeRef('beta', 'uid-beta'),
          start: 0,
          end: 4
        }
      ],
      usageLinks: [
        {
          v: 1,
          edgeKind: 'usage',
          fromChunkUid: 'uid-alpha',
          to: makeRef('beta', 'uid-beta')
        }
      ]
    }
  },
  {
    file: 'src/beta.js',
    name: 'beta',
    kind: 'function',
    chunkUid: 'uid-beta',
    metaV2: {
      file: 'src/beta.js',
      virtualPath: 'src/beta.js',
      chunkUid: 'uid-beta',
      symbol: makeSymbol('beta', 'uid-beta', 'src/beta.js')
    }
  }
]);

export const runSymbolArtifactWriters = async ({
  outDir,
  chunks,
  maxJsonBytes = null,
  includeSymbols = true,
  includeOccurrences = true,
  includeEdges = true,
  useFileIndex = false
}) => {
  const writes = [];
  const pieceEntries = [];
  const enqueueWrite = (label, job) => writes.push({ label, job });
  const addPieceFile = (entry, filePath) => pieceEntries.push({ entry, filePath });
  const formatArtifactLabel = (value) => value;

  let fileMeta = [];
  let fileIdByPath;
  let chunkUidToFileId;
  if (useFileIndex) {
    const built = buildFileMeta({ chunks });
    fileMeta = built.fileMeta;
    fileIdByPath = built.fileIdByPath;
    chunkUidToFileId = new Map();
    for (const chunk of chunks) {
      const fileId = fileIdByPath.get(chunk.file);
      if (!Number.isFinite(fileId)) continue;
      if (chunk.chunkUid) chunkUidToFileId.set(chunk.chunkUid, fileId);
    }
  }

  if (includeSymbols) {
    await enqueueSymbolsArtifacts({
      state: { chunks },
      outDir,
      maxJsonBytes,
      compression: null,
      enqueueWrite,
      addPieceFile,
      formatArtifactLabel
    });
  }

  if (includeOccurrences) {
    await enqueueSymbolOccurrencesArtifacts({
      state: { chunks },
      fileIdByPath,
      chunkUidToFileId,
      outDir,
      maxJsonBytes,
      compression: null,
      enqueueWrite,
      addPieceFile,
      formatArtifactLabel
    });
  }

  if (includeEdges) {
    await enqueueSymbolEdgesArtifacts({
      state: { chunks },
      fileIdByPath,
      chunkUidToFileId,
      outDir,
      maxJsonBytes,
      compression: null,
      enqueueWrite,
      addPieceFile,
      formatArtifactLabel
    });
  }

  for (const { job } of writes) {
    await job();
  }

  return { pieceEntries, fileMeta, fileIdByPath };
};

