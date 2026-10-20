import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { resolveOnnxModelPath } from './onnx-embeddings/config.js';

const TOKENIZER_FILES = new Set([
  'config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json',
  'vocab.json', 'vocab.txt', 'merges.txt', 'tokenizer.model', 'sentencepiece.bpe.model',
  'spiece.model', 'added_tokens.json'
]);
const unknown = (weightsDigest = null) => ({ weightsDigest, status: 'unknown', reuse: 'refuse', attempt: crypto.randomUUID(),
  method: 'local-artifacts-unavailable', digest: null, revision: null });

/** Hash opened bytes with bounded working storage, rejecting replacement during a read. */
const fingerprintFile = (filePath) => {
  const fd = fs.openSync(filePath, 'r');
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile()) throw new Error('Embedding artifact is not a regular file.');
    const hash = crypto.createHash('sha256');
    const scratch = Buffer.allocUnsafe(1024 * 1024);
    let bytes = 0;
    for (;;) {
      const count = fs.readSync(fd, scratch, 0, scratch.length, null);
      if (!count) break;
      bytes += count;
      hash.update(scratch.subarray(0, count));
    }
    const after = fs.fstatSync(fd, { bigint: true });
    const current = fs.statSync(filePath, { bigint: true });
    for (const field of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']) {
      if (before[field] !== after[field] || after[field] !== current[field]) {
        throw Object.assign(new Error('Embedding artifact changed during verification.'), {
          code: 'ERR_EMBEDDING_ARTIFACT_CHANGED'
        });
      }
    }
    if (BigInt(bytes) !== after.size) throw new Error('Embedding artifact read is incomplete.');
    return { bytes, sha256: hash.digest('hex') };
  } finally { fs.closeSync(fd); }
};

const inventoryFiles = (root, prefix = '', depth = 0) => {
  if (!root || !fs.existsSync(root)) return [];
  const entries = fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (entries.length > 128) throw new Error('Embedding artifact inventory exceeds its bounded file count.');
  const out = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory() && depth < 1 && ['onnx', 'main'].includes(entry.name)) {
      out.push(...inventoryFiles(path.join(root, entry.name), rel, depth + 1));
    } else if (entry.isFile() && (TOKENIZER_FILES.has(entry.name)
      || /(?:\.onnx(?:_data)?|\.data|\.onnx\.data|\.onnx_data\.\d+)$/u.test(entry.name))) {
      out.push({ rel, filePath: path.join(root, entry.name) });
    }
  }
  return out;
};

// Match the pinned Transformers.js loader's repository-ID/direct-path split
// without initializing a provider. Invalid repository IDs (including bare local
// paths with multiple slashes) are direct paths, not cache-relative model IDs.
const isRepositoryId = id => /^(\b[\w.-]+\b\/)?\b[\w.-]{1,96}\b$/u.test(id)
  && !id.includes('..') && !id.includes('--') && !/\.(?:git|ipynb)$/u.test(id);
export const resolveEmbeddingArtifactRoot = (id, modelsDir) => {
  if (typeof id !== 'string' || !id) return null;
  if (!isRepositoryId(id)) {
    const directRoot = path.resolve(id);
    const cacheRoot = modelsDir ? path.resolve(path.join(modelsDir, id)) : null;
    // Transformers checks its filesystem cache before direct local files. A
    // shadow inventory can mix sources file-by-file; refuse that ambiguous
    // authority rather than verify only the direct directory.
    if (cacheRoot && cacheRoot !== directRoot && inventoryFiles(cacheRoot).length) return null;
    return directRoot;
  }
  return modelsDir ? path.join(modelsDir, id) : null;
};

/** No provider loading or network I/O. Unknown evidence is scoped to one attempt. */
export const resolveEmbeddingArtifactIdentity = ({ provider, modelId, modelsDir, rootDir,
  onnx = null, modelProfile = null, stub = false } = {}) => {
  if (stub) return { status: 'stub', reuse: 'allow', digest: null, revision: null, method: 'deterministic-stub' };
  if (modelProfile?.revision) return { status: 'immutable-revision', reuse: 'allow',
    digest: null, revision: modelProfile.revision, method: 'qualified-model-profile' };
  const modelPath = provider === 'onnx' ? resolveOnnxModelPath({
    rootDir, modelPath: onnx?.resolvedModelPath || onnx?.modelPath, modelsDir, modelId
  }) : null;
  const modelRoot = resolveEmbeddingArtifactRoot(modelId, modelsDir);
  const tokenizerId = onnx?.tokenizerId || modelId;
  const tokenizerRoot = resolveEmbeddingArtifactRoot(tokenizerId, modelsDir);
  const rootFiles = inventoryFiles(provider === 'onnx' ? tokenizerRoot : modelRoot);
  const tokenizerFiles = rootFiles.filter(({ rel, filePath }) => !rel.includes('/')
    && TOKENIZER_FILES.has(path.basename(filePath)));
  const files = provider === 'onnx' && modelPath
    ? [{ rel: 'weights/model.onnx', filePath: modelPath },
      ...inventoryFiles(path.dirname(modelPath)).filter(({ filePath }) => filePath !== modelPath
        && !TOKENIZER_FILES.has(path.basename(filePath)))
        .map(({ rel, filePath }) => ({ rel: `weights/${rel}`, filePath })),
      ...tokenizerFiles.map(({ rel, filePath }) => ({ rel: `tokenizer/${rel}`, filePath }))]
    : rootFiles;
  const hasWeights = files.some(({ filePath }) => /\.onnx$/u.test(filePath));
  const hasTokenizer = tokenizerFiles.some(({ filePath }) => /(?:tokenizer\.json|vocab\.(?:json|txt)|(?:tokenizer|spiece)\.model|sentencepiece\.bpe\.model)$/u.test(filePath));
  if (!hasWeights || !hasTokenizer) return unknown(modelPath ? fingerprintFile(modelPath).sha256 : null);
  const seen = new Set();
  const inventory = files.filter(({ rel }) => !seen.has(rel) && seen.add(rel))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
    .map(({ rel, filePath }) => ({ path: rel, ...fingerprintFile(filePath) }));
  if (inventory.length > 128) throw new Error('Embedding artifact inventory exceeds its bounded file count.');
  return { status: 'verified', reuse: 'allow', revision: null, method: 'opened-local-artifacts-sha256',
    digest: crypto.createHash('sha256').update(JSON.stringify(inventory)).digest('hex'), inventory };
};

export const embeddingArtifactReusable = (artifact) => artifact?.reuse === 'allow'
  && ['verified', 'immutable-revision', 'stub'].includes(artifact.status)
  && (artifact.status !== 'verified' || /^[a-f0-9]{64}$/u.test(artifact.digest || ''));

/** Dense cross-run compatibility needs evidence beyond ID/path and dimensions. */
export const assertEmbeddingArtifactCompatibility = (expected, actual) => {
  if (!embeddingArtifactReusable(expected) || !embeddingArtifactReusable(actual)
    || expected.status !== actual.status || expected.digest !== actual.digest
    || expected.revision !== actual.revision) {
    throw Object.assign(new Error('Embedding model artifact identity is unknown or changed. Download/verify the model and rebuild the dense index.'), {
      code: 'ERR_EMBEDDING_ARTIFACT_INCOMPATIBLE'
    });
  }
};
