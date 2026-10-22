import fsSync from 'node:fs';
import {
  loadChunkMeta,
  loadJsonArrayArtifact,
  loadJsonObjectArtifact,
  loadMinhashSignatures,
  loadTokenPostings
} from '../../../shared/artifact-io/loaders.js';
import {
  loadPiecesManifest,
  readCompatibilityKey
} from '../../../shared/artifact-io/manifest.js';
import {
  loadDenseVectorBinaryFromMetaAsync,
  resolveDenseVectorBinaryArtifact
} from '../../../shared/dense-vector-artifacts.js';
import { isOptionalArtifactMissingError } from '../../../shared/artifact-io/optional-fallback.js';

/**
 * Load manifest-backed artifacts from an existing index directory and normalize
 * chunk metadata with file-level fallback fields.
 *
 * @param {string} dir
 * @param {{strict?:boolean}} [options]
 * @returns {Promise<object>}
 */
export const loadIndexArtifacts = async (dir, { strict = true, expectedMode = null } = {}) => {
  if (!fsSync.existsSync(dir)) {
    throw new Error(`Missing input index directory: ${dir}`);
  }
  const manifest = loadPiecesManifest(dir, { strict });
  const isDeclared = name => manifest?.pieces?.some(piece => piece.name === name || piece.name === `${name}_meta`) === true;
  const loadOptional = async (name, loader) => {
    const declared = isDeclared(name);
    if (strict && !declared) return null;
    try { return await loader(dir, name, { manifest, strict }); }
    catch (error) {
      if (!declared && isOptionalArtifactMissingError(error)) return null;
      throw error;
    }
  };
  const optionalArray = name => loadOptional(name, loadJsonArrayArtifact);
  const optionalObject = name => loadOptional(name, loadJsonObjectArtifact);
  const indexState = await optionalObject('index_state');
  const persistedMode = indexState?.fields?.mode ?? indexState?.mode ?? manifest?.mode ?? null;
  if (expectedMode && persistedMode !== expectedMode) {
    throw new Error(`Piece input mode mismatch in ${dir}: expected ${expectedMode}, found ${persistedMode || 'missing'}.`);
  }
  const chunkMeta = await loadChunkMeta(dir, { manifest, strict });
  const fileMeta = await optionalArray('file_meta');
  const fileMetaById = new Map();
  const fileMetaByPath = new Map();
  const fileInfoByPath = new Map();
  const fileList = [];
  if (Array.isArray(fileMeta)) {
    for (const entry of fileMeta) {
      if (entry && entry.id != null) fileMetaById.set(entry.id, entry);
      if (entry?.file) {
        fileMetaByPath.set(entry.file, entry);
        fileList.push(entry.file);
        const size = Number.isFinite(entry.size) ? entry.size : null;
        const hash = entry.hash || null;
        const hashAlgo = entry.hash_algo || entry.hashAlgo || null;
        const encoding = entry.encoding || null;
        const encodingFallback = typeof entry.encodingFallback === 'boolean' ? entry.encodingFallback : null;
        const encodingFallbackClass = typeof entry.encodingFallbackClass === 'string'
          ? entry.encodingFallbackClass
          : null;
        const encodingFallbackRisk = typeof entry.encodingFallbackRisk === 'string'
          ? entry.encodingFallbackRisk
          : null;
        const encodingConfidence = Number.isFinite(entry.encodingConfidence)
          ? entry.encodingConfidence
          : null;
        fileInfoByPath.set(entry.file, {
          ...entry,
          size,
          hash,
          hashAlgo,
          encoding,
          encodingFallback,
          encodingFallbackClass,
          encodingFallbackRisk,
          encodingConfidence
        });
      }
    }
  }
  for (const chunk of chunkMeta) {
    if (!chunk) continue;
    if (!chunk.file && chunk.metaV2?.file) chunk.file = chunk.metaV2.file;
    if (!chunk.ext && chunk.metaV2?.ext) chunk.ext = chunk.metaV2.ext;
    const meta = fileMetaById.get(chunk.fileId) || fileMetaByPath.get(chunk.file);
    if (!meta) continue;
    if (!chunk.file) chunk.file = meta.file;
    if (!chunk.ext) chunk.ext = meta.ext;
    if (chunk.fileSize == null && Number.isFinite(meta.size)) chunk.fileSize = meta.size;
    if (chunk.fileHash == null && meta.hash != null) chunk.fileHash = meta.hash;
    const metaHashAlgo = meta.hashAlgo || meta.hash_algo;
    if (chunk.fileHashAlgo == null && metaHashAlgo != null) chunk.fileHashAlgo = metaHashAlgo;
    for (const field of ['externalDocs', 'last_modified', 'last_author', 'churn', 'churn_added', 'churn_deleted', 'churn_commits']) {
      if (chunk[field] == null && meta[field] != null) chunk[field] = meta[field];
    }
  }
  const missingFileCount = chunkMeta.reduce((count, chunk) => (
    chunk && !chunk.file ? count + 1 : count
  ), 0);
  if (missingFileCount > 0) {
    throw new Error(`file_meta artifact required for chunk metadata in ${dir} (missing files: ${missingFileCount})`);
  }
  const tokenPostings = loadTokenPostings(dir, { manifest, strict });
  /**
   * Load dense vectors using binary metadata and payload only.
   *
   * Piece assembly intentionally materializes row views from binary buffers in
   * merge-time logic to avoid monolithic dense JSON reads.
   */
  const loadDenseVectorArtifact = async (artifactName) => {
    const descriptor = resolveDenseVectorBinaryArtifact(artifactName);
    if (!descriptor) return null;
    if (strict && !isDeclared(artifactName) && !isDeclared(descriptor.metaName)) return null;
    const meta = await optionalObject(descriptor.metaName);
    if (!meta && isDeclared(artifactName)) throw new Error(`Declared dense vectors lack readable metadata: ${artifactName}`);
    if (!meta) return null;
    return await loadDenseVectorBinaryFromMetaAsync({
      dir,
      baseName: descriptor.baseName,
      meta,
      manifest,
      strict
    });
  };
  const [denseVec, denseVecDoc, denseVecCode] = await Promise.all([
    loadDenseVectorArtifact('dense_vectors'),
    loadDenseVectorArtifact('dense_vectors_doc'),
    loadDenseVectorArtifact('dense_vectors_code')
  ]);
  return {
    dir,
    chunkMeta,
    tokenPostings,
    fieldPostings: await optionalObject('field_postings'),
    fieldTokens: await optionalArray('field_tokens'),
    minhash: await loadOptional('minhash_signatures', (root, _name, options) => loadMinhashSignatures(root, options)),
    phraseNgrams: await optionalObject('phrase_ngrams'),
    chargrams: await optionalObject('chargram_postings'),
    denseVec,
    denseVecDoc,
    denseVecCode,
    fileRelations: await optionalArray('file_relations'),
    callSites: await optionalArray('call_sites'),
    riskSummaries: await optionalArray('risk_summaries'),
    riskFlows: await optionalArray('risk_flows'),
    riskPartialFlows: await optionalArray('risk_partial_flows'),
    riskInterproceduralStats: await optionalObject('risk_interprocedural_stats'),
    indexState,
    fileInfoByPath,
    fileList
  };
};

/**
 * Read compatibility keys for candidate index directories.
 *
 * @param {string[]} inputs
 * @param {{strict?:boolean}} [options]
 * @returns {Map<string,string>}
 */
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
