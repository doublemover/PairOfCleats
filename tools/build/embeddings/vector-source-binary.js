import fs from 'node:fs';
import path from 'node:path';
import { DENSE_VECTOR_BINARY_ARTIFACTS, resolveDenseVectorBinaryPayloadPath } from '../../../src/shared/dense-vector-binary.js';
import { resolveBinaryArtifactPath } from '../../../src/shared/artifact-io/manifest.js';
import { readVerifiedContainedFileSync } from '../../../src/shared/contained-file.js';
import { normalizeDenseVectorStreamMeta, iterateDenseVectorBinaryRows } from '../../../src/shared/dense-vector-stream.js';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { createXxhash64Hasher } from '../../../src/shared/hash/xxhash-backend.js';
import { resolveDenseQuantizationSpec } from '../../../src/shared/embedding-quantization-spec.js';

const invalid = message => Object.assign(new Error(message), { code: 'ERR_DENSE_VECTOR_SOURCE_IDENTITY' });
const fields = value => value?.fields || value;
const named = (manifest, name) => (manifest?.pieces || []).filter(piece => piece?.name === name);
const readMetadata = (dir, filename, entry = null) => {
  const checksum = entry?.checksum;
  const xxh64 = typeof checksum === 'string' && /^xxh64:[a-f0-9]{16}$/i.test(checksum);
  const read = readVerifiedContainedFileSync(dir, filename, { maxBytes: 64 * 1024 * 1024,
    expectedBytes: entry?.bytes ?? null, expectedHash: checksum && !xxh64 ? checksum.split(':')[1] : null,
    hashAlgorithm: checksum && !xxh64 ? checksum.split(':')[0] : 'sha256' });
  const meta = fields(JSON.parse(read.buffer.toString('utf8')));
  let bytes = xxh64 ? read.buffer : null, verification = null;
  return { meta, verify: () => verification ||= (async () => {
    if (!bytes) return;
    try {
      const digest = await createXxhash64Hasher(); digest.update(bytes);
      if (`xxh64:${digest.digest()}` !== checksum.toLowerCase()) throw invalid('Dense binary metadata differs from its manifest checksum.');
    } finally { bytes = null; }
  })() };
};

/** Only a manifest-selected binary and its metadata may replace textual ANN
 * handoff. An undeclared neighboring binary is never discovered implicitly. */
export const resolveBinaryVectorsSource = ({ dir, artifactBase, manifest, expectedDims = null, expectedModelId = null,
  expectedEmbeddingIdentity = null, expectedEmbeddingGeneration = null, expectedQuantization = null, signal = null, metrics = null }) => {
  const descriptor = Object.entries(DENSE_VECTOR_BINARY_ARTIFACTS).find(([name, spec]) => name === artifactBase || spec.baseName === artifactBase);
  if (!descriptor) return null;
  const [name, spec] = descriptor;
  const binaries = named(manifest, name).filter(piece => ['bin', 'binary'].includes(piece.format) || piece.path?.endsWith('.bin'));
  if (!binaries.length) return null;
  if (binaries.length !== 1) throw invalid(`Ambiguous manifested dense binary: ${name}`);
  const metaEntries = named(manifest, spec.metaName);
  if (metaEntries.length !== 1) throw invalid(`Missing or ambiguous manifested dense binary metadata: ${name}`);
  const metaPath = resolveBinaryArtifactPath(dir, spec.metaName, { manifest, strict: true });
  const metadata = readMetadata(dir, metaPath, metaEntries[0]);
  const meta = normalizeDenseVectorStreamMeta(metadata.meta);
  resolveDenseQuantizationSpec(meta, expectedQuantization);
  if (meta.format !== 'uint8-row-major' || (meta.artifact != null && meta.artifact !== spec.baseName)
    || (expectedDims != null && meta.dims !== expectedDims) || (expectedModelId != null && meta.model !== expectedModelId)
    || (expectedEmbeddingIdentity != null && stableStringify(meta.embeddingIdentity) !== stableStringify(expectedEmbeddingIdentity))
    || (expectedEmbeddingGeneration != null && meta.embeddingGeneration !== expectedEmbeddingGeneration)) {
    throw invalid(`Dense binary metadata disagrees with the selected backend input: ${name}`);
  }
  const filename = resolveDenseVectorBinaryPayloadPath({ dir, baseName: spec.baseName, meta, manifest, strict: true });
  const binary = binaries[0];
  if ((binary.count != null && binary.count !== meta.count) || (binary.dims != null && binary.dims !== meta.dims)
    || (binary.bytes != null && binary.bytes !== meta.count * meta.dims)) throw invalid(`Manifested dense binary dimensions/count disagree: ${name}`);
  const primaryPath = path.join(dir, `${spec.baseName}.meta.json`);
  if (fs.existsSync(primaryPath)) {
    const { format, ...geometry } = readMetadata(dir, primaryPath).meta;
    // The companion describes JSONL shards, not binary row-major bytes. Share
    // geometry/validity admission without imposing the binary encoding on it.
    if (format != null && format !== 'jsonl-sharded') throw invalid(`Invalid dense textual metadata format: ${name}`);
    const primary = normalizeDenseVectorStreamMeta(geometry);
    for (const key of ['count', 'dims', 'model', 'validity', 'embeddingIdentity', 'embeddingGeneration', 'minVal', 'maxVal', 'levels', 'scale']) {
      if (stableStringify(primary[key]) !== stableStringify(meta[key])) throw invalid(`Dense binary and textual metadata disagree on ${key}: ${name}`);
    }
  }
  return { count: meta.count, vectors: null, format: 'uint8-row-major', meta,
    rows: { async *[Symbol.asyncIterator]() {
      await metadata.verify();
      yield* iterateDenseVectorBinaryRows({ root: dir, filename, meta, expectedChecksum: binary.checksum ?? null, signal, metrics });
    } } };
};
