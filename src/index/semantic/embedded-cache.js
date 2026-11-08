import { openSemanticCacheEntry, persistSemanticCacheEntry, relocateSemanticCacheEntry } from '../build/incremental/semantic-cache.js';
import { readRetainedSemanticSourceSnapshot } from '../../semantic/retained-source-snapshot.js';
import { readRetainedEmbeddedSourceMap, assertRetainedEmbeddedSourceRange } from './embedded-map-read.js';
import { withPreparedEmbeddedParent, readPreparedEmbeddedParent } from './embedded-parent.js';
import { throwIfAborted } from '../../shared/abort.js';
import path from 'node:path';
import { assertSemanticReplayContext } from '../build/incremental/replay-authority.js';
import { describeStorageFailure } from '../../shared/storage/failure-observation.js';
const fail = message => Object.assign(new Error(message), { code: 'ERR_SEMANTIC_CACHE_INTEGRITY' });
export const persistEmbeddedSemanticCacheEntries = async ({ entries = [], ...options }) => {
  const result = [];
  for (const { segmentUid, factsRef } of entries) result.push({ segmentUid, locator: await persistSemanticCacheEntry({ ...options, factsRef }) });
  return result;
};
/** Parent bytes gate all segment maps; local source hashes then gate individual immutable cache entries. */
export const relocateEmbeddedSemanticCacheEntries = async ({ entries = [], parentFacts, parentBytes,
  repoRoot, bundleDir, dependencySignatures, targetBuildRoot, storage, diskAccount, signal = null,
  replayVerification = null, metrics = null }) => {
  if (!Array.isArray(entries)) throw fail('Invalid embedded semantic cache inventory.');
  const facts = [], evidenceArtifacts = [], seen = new Set();
  if (!entries.length) return { semanticSegmentFactsRefs: facts, semanticEvidenceArtifacts: evidenceArtifacts };
  if (replayVerification) assertSemanticReplayContext(replayVerification, path.resolve(bundleDir));
  return withPreparedEmbeddedParent({ parentFacts, parentBytes, diskAccount, signal, metrics }, async preparedParent => {
    for (const entry of entries) {
      throwIfAborted(signal);
      if (!entry || typeof entry.segmentUid !== 'string' || !entry.segmentUid || Object.keys(entry).some(key => !['segmentUid','locator'].includes(key))) throw fail('Invalid embedded semantic cache locator.');
      let verification, source;
      if (replayVerification) {
        verification = await replayVerification.verifyEmbedded({ repoRoot, locator: entry.locator, dependencySignatures,
          parentFacts, preparedParent, segmentUid: entry.segmentUid, signal });
        source = verification.embeddedSource;
      } else {
        if (metrics) metrics.childDescriptorOpens = (metrics.childDescriptorOpens || 0) + 1;
        const opened = await openSemanticCacheEntry({ repoRoot, bundleDir, locator: entry.locator, expectedDependencySignatures: dependencySignatures, expectedRepositoryNamespace: parentFacts.repositoryNamespace, signal });
        source = await validateEmbeddedCacheSource({ opened, parentFacts, preparedParent, segmentUid: entry.segmentUid, signal, metrics });
      }
      if (seen.has(source.sourceUnitId)) throw fail('Duplicate embedded cache source.'); seen.add(source.sourceUnitId);
      const factsRef = await relocateSemanticCacheEntry({ repoRoot,bundleDir,locator:entry.locator,dependencySignatures,
        sourceHash:source.byteHash,sourcePath:source.path,repositoryNamespace:parentFacts.repositoryNamespace,targetBuildRoot,storage,diskAccount,evidenceArtifacts,signal,
        verificationToken: verification?.token, replayMetrics: replayVerification?.metrics });
      facts.push({ segmentUid: entry.segmentUid, factsRef });
      if (verification) replayVerification.recordReplay(verification.token, factsRef, verification.verificationReceipt);
    }
    return { semanticSegmentFactsRefs: facts, semanticEvidenceArtifacts: evidenceArtifacts };
  });
};

export const validateEmbeddedCacheSource = async ({ opened, parentFacts, preparedParent, segmentUid, signal = null, metrics = null }) => {
  throwIfAborted(signal);
  const { text } = readPreparedEmbeddedParent(preparedParent, parentFacts);
  try {
    if (metrics) metrics.childSourceReads = (metrics.childSourceReads || 0) + 1;
    const { source, text: localText } = await readRetainedSemanticSourceSnapshot({ store: opened.store,
      partitionId: opened.factsRef.syntaxPartitionId, maxBytes: 64 * 1024 * 1024, signal });
    if (metrics) metrics.childMapReads = (metrics.childMapReads || 0) + 1;
    const map = await readRetainedEmbeddedSourceMap({ store: opened.store, source, parentFacts, signal });
    if (map.segmentUid !== segmentUid) throw fail('Embedded cache segment identity differs from its retained map.');
    assertRetainedEmbeddedSourceRange({ map, source, localText, parentText: text,
      parentSource: { repositoryNamespace: parentFacts.repositoryNamespace, sourceUnitId: parentFacts.sourceUnitId,
        byteHash: parentFacts.sourceHash, textLength: text.length } });
    return source;
  } catch (error) {
    const diagnostic = describeStorageFailure(error, { phase: 'embedded-cache-source-qualification' });
    if (['ERR_SEMANTIC_SOURCE_MISMATCH', 'ERR_EMBEDDED_SOURCE_MAP_CONTRACT', 'ERR_FILE_INTEGRITY'].includes(diagnostic.code)) {
      throw Object.assign(fail('Embedded cache source/map qualification failed.'), { cause: error });
    }
    throw error;
  }
};
