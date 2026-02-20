import fsSync from 'node:fs';
import {
  loadChunkMeta,
  loadJsonArrayArtifact,
  loadPiecesManifest,
  loadTokenPostings,
  readCompatibilityKey
} from '../../../shared/artifact-io.js';
import { readJsonOptional } from './helpers.js';

export const loadIndexArtifacts = async (dir, { strict = true } = {}) => {
  if (!fsSync.existsSync(dir)) {
    throw new Error(`Missing input index directory: ${dir}`);
  }
  const manifest = loadPiecesManifest(dir, { strict });
  const chunkMeta = await loadChunkMeta(dir, { manifest, strict });
  const fileMeta = await loadJsonArrayArtifact(dir, 'file_meta', { manifest, strict }).catch(() => null);
  const fileMetaById = new Map();
  const fileInfoByPath = new Map();
  const fileList = [];
  if (Array.isArray(fileMeta)) {
    for (const entry of fileMeta) {
      if (entry && entry.id != null) fileMetaById.set(entry.id, entry);
      if (entry?.file) {
        fileList.push(entry.file);
        const size = Number.isFinite(entry.size) ? entry.size : null;
        const hash = entry.hash || null;
        const hashAlgo = entry.hash_algo || entry.hashAlgo || null;
        const encoding = entry.encoding || null;
        const encodingFallback = typeof entry.encodingFallback === 'boolean' ? entry.encodingFallback : null;
        const encodingConfidence = Number.isFinite(entry.encodingConfidence)
          ? entry.encodingConfidence
          : null;
        fileInfoByPath.set(entry.file, {
          size,
          hash,
          hashAlgo,
          encoding,
          encodingFallback,
          encodingConfidence
        });
      }
    }
  }
  for (const chunk of chunkMeta) {
    if (!chunk || (chunk.file && chunk.ext)) continue;
    if (!chunk.file && chunk.metaV2?.file) chunk.file = chunk.metaV2.file;
    if (!chunk.ext && chunk.metaV2?.ext) chunk.ext = chunk.metaV2.ext;
    if (chunk.file && chunk.ext) continue;
    const meta = fileMetaById.get(chunk.fileId);
    if (!meta) continue;
    if (!chunk.file) chunk.file = meta.file;
    if (!chunk.ext) chunk.ext = meta.ext;
    if (!chunk.fileSize && Number.isFinite(meta.size)) chunk.fileSize = meta.size;
    if (!chunk.fileHash && meta.hash) chunk.fileHash = meta.hash;
    const metaHashAlgo = meta.hashAlgo || meta.hash_algo;
    if (!chunk.fileHashAlgo && metaHashAlgo) chunk.fileHashAlgo = metaHashAlgo;
    if (!chunk.externalDocs) chunk.externalDocs = meta.externalDocs;
    if (!chunk.last_modified) chunk.last_modified = meta.last_modified;
    if (!chunk.last_author) chunk.last_author = meta.last_author;
    if (!chunk.churn) chunk.churn = meta.churn;
    if (!chunk.churn_added) chunk.churn_added = meta.churn_added;
    if (!chunk.churn_deleted) chunk.churn_deleted = meta.churn_deleted;
    if (!chunk.churn_commits) chunk.churn_commits = meta.churn_commits;
  }
  const missingFileCount = chunkMeta.reduce((count, chunk) => (
    chunk && !chunk.file ? count + 1 : count
  ), 0);
  if (missingFileCount > 0) {
    throw new Error(`file_meta artifact required for chunk metadata in ${dir} (missing files: ${missingFileCount})`);
  }
  const tokenPostings = loadTokenPostings(dir, { manifest, strict });
  return {
    dir,
    chunkMeta,
    tokenPostings,
    fieldPostings: readJsonOptional(dir, 'field_postings.json'),
    fieldTokens: readJsonOptional(dir, 'field_tokens.json'),
    minhash: readJsonOptional(dir, 'minhash_signatures.json'),
    phraseNgrams: readJsonOptional(dir, 'phrase_ngrams.json'),
    chargrams: readJsonOptional(dir, 'chargram_postings.json'),
    denseVec: readJsonOptional(dir, 'dense_vectors_uint8.json'),
    denseVecDoc: readJsonOptional(dir, 'dense_vectors_doc_uint8.json'),
    denseVecCode: readJsonOptional(dir, 'dense_vectors_code_uint8.json'),
    fileRelations: await loadJsonArrayArtifact(dir, 'file_relations', { manifest, strict }).catch(() => null),
    callSites: await loadJsonArrayArtifact(dir, 'call_sites', { manifest, strict }).catch(() => null),
    riskSummaries: await loadJsonArrayArtifact(dir, 'risk_summaries', { manifest, strict }).catch(() => null),
    riskFlows: await loadJsonArrayArtifact(dir, 'risk_flows', { manifest, strict }).catch(() => null),
    riskInterproceduralStats: readJsonOptional(dir, 'risk_interprocedural_stats.json'),
    indexState: readJsonOptional(dir, 'index_state.json'),
    fileInfoByPath,
    fileList
  };
};

export const readCompatibilityKeys = (inputs, { strict = true } = {}) => {
  const compatibilityKeys = new Map();
  for (const dir of inputs) {
    const result = readCompatibilityKey(dir, { strict });
    if (result?.key) {
      compatibilityKeys.set(dir, result.key);
    }
  }
  return compatibilityKeys;
};
