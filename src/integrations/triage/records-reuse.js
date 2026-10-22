import { createHash } from 'node:crypto';
import { stableStringify } from '../../shared/stable-json.js';
import { embeddingArtifactReusable } from '../../shared/embedding-artifact-identity.js';
import { MINHASH_HASH_IDENTITY } from '../../index/minhash.js';
import { TEXT_ANALYZER_VERSION } from '../../shared/text-analyzer.js';
import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';
import { SEMANTIC_ANALYSIS_VERSIONS } from '../../index/semantic/analysis-versions.js';
import { readIncrementalBundleSnapshot } from '../../index/build/incremental/bundle-snapshot.js';
import { throwIfAborted } from '../../shared/abort.js';
const hash = value => createHash('sha256').update(stableStringify(value)).digest('hex');

export const recordsReusePolicy = ({ runtime, policy, stop, synonyms }) => {
  const identity = runtime.embeddingIdentity;
  const inlineKnown = runtime.embeddingEnabled !== true || (embeddingArtifactReusable(identity?.modelArtifact)
    && typeof runtime.embeddingIdentityKey === 'string' && runtime.embeddingIdentityKey
    && Number.isSafeInteger(identity?.dims) && identity.dims > 0);
  const complete = { schema: 'records-producer-reuse.v1', artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    producer: '2', lexical: SEMANTIC_ANALYSIS_VERSIONS.lexicalAnalyzer, literal: TEXT_ANALYZER_VERSION,
    minhash: MINHASH_HASH_IDENTITY, policy, stop: [...stop].sort(),
    synonyms: [...synonyms].sort(([left], [right]) => String(left).localeCompare(String(right))),
    embedding: { enabled: runtime.embeddingEnabled === true, service: runtime.embeddingService === true,
      modelId: runtime.modelId ?? null, identity: identity ?? null, key: runtime.embeddingIdentityKey ?? null,
      config: runtime.indexingConfig?.embeddings ?? null } };
  return { key: hash(complete), allowed: Boolean(inlineKnown), reason: inlineKnown ? 'complete-policy' : 'unknown-inline-embedding-identity', snapshot: JSON.parse(stableStringify(complete)) };
};

export const readReusableRecordChunk = async ({ incrementalState, repoRoot, file, logicalHash, policy, textLength, signal }) => {
  throwIfAborted(signal);
  const entry = incrementalState?.manifest?.files?.[file];
  if (!incrementalState?.enabled || !policy.allowed || !entry || entry.hash !== logicalHash
    || entry.dependencySignatures?.recordsProducer !== policy.key) return { chunk: null, reason: policy.reason || 'source-or-policy-changed' };
  const loaded = await readIncrementalBundleSnapshot({ repoRoot, bundleDir: incrementalState.bundleDir,
    relKey: file, entry, fallbackFormat: incrementalState.bundleFormat, signal });
  const chunks = loaded?.bundle?.chunks;
  if (!Array.isArray(chunks) || chunks.length !== 1) return { chunk: null, reason: 'missing-or-incomplete-bundle' };
  const chunk = chunks[0];
  if (chunk.file !== file || chunk.start !== 0 || chunk.end !== textLength || chunk.kind !== 'Record'
    || !chunk.chunkUid || !Array.isArray(chunk.tokens) || !chunk.tokens.length
    || !Array.isArray(chunk.phraseTokens) || chunk.phraseTokensCasePreserved !== true) return { chunk: null, reason: 'incompatible-record-products' };
  if (policy.snapshot.embedding.enabled) {
    const vector = chunk.embedding;
    if ((!Array.isArray(vector) && !ArrayBuffer.isView(vector))
      || vector.length !== policy.snapshot.embedding.identity.dims || Array.from(vector).some(value => !Number.isFinite(value))) {
      return { chunk: null, reason: 'incomplete-inline-vector' };
    }
  }
  throwIfAborted(signal);
  return { chunk: structuredClone(chunk), reason: 'sealed-record-products' };
};
