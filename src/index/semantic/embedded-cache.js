import { createHash } from 'node:crypto';
import { openSemanticCacheEntry, persistSemanticCacheEntry, relocateSemanticCacheEntry } from '../build/incremental/semantic-cache.js';
import { readRetainedSemanticSourceSnapshot } from '../../semantic/retained-source-snapshot.js';
import { readRetainedEmbeddedSourceMap, assertRetainedEmbeddedSourceRange } from './embedded-map-read.js';
const fail = message => Object.assign(new Error(message), { code: 'ERR_SEMANTIC_CACHE_INTEGRITY' });
export const persistEmbeddedSemanticCacheEntries = async ({ entries = [], ...options }) => {
  const result = [];
  for (const { segmentUid, factsRef } of entries) result.push({ segmentUid, locator: await persistSemanticCacheEntry({ ...options, factsRef }) });
  return result;
};
/** Parent bytes gate all segment maps; local source hashes then gate individual immutable cache entries. */
export const relocateEmbeddedSemanticCacheEntries = async ({ entries = [], parentFacts, parentBytes,
  repoRoot, bundleDir, dependencySignatures, targetBuildRoot, storage, diskAccount, signal = null }) => {
  if (!Array.isArray(entries)) throw fail('Invalid embedded semantic cache inventory.');
  const facts = [], evidenceArtifacts = [], seen = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry.segmentUid !== 'string' || !entry.segmentUid || Object.keys(entry).some(key => !['segmentUid','locator'].includes(key))) throw fail('Invalid embedded semantic cache locator.');
    const opened = await openSemanticCacheEntry({ repoRoot, bundleDir, locator: entry.locator, expectedDependencySignatures: dependencySignatures, expectedRepositoryNamespace: parentFacts.repositoryNamespace, signal });
    const source = await validateEmbeddedCacheSource({ opened, parentFacts, parentBytes, segmentUid: entry.segmentUid, signal });
    if (seen.has(source.sourceUnitId)) throw fail('Duplicate embedded cache source.'); seen.add(source.sourceUnitId);
    facts.push({ segmentUid: entry.segmentUid, factsRef: await relocateSemanticCacheEntry({ repoRoot,bundleDir,locator:entry.locator,dependencySignatures,
      sourceHash:source.byteHash,sourcePath:source.path,repositoryNamespace:parentFacts.repositoryNamespace,targetBuildRoot,storage,diskAccount,evidenceArtifacts,signal }) });
  }
  return { semanticSegmentFactsRefs: facts, semanticEvidenceArtifacts: evidenceArtifacts };
};

export const validateEmbeddedCacheSource = async ({ opened, parentFacts, parentBytes, segmentUid, signal = null }) => {
  if (!(parentBytes instanceof Uint8Array) || createHash('sha256').update(parentBytes).digest('hex') !== parentFacts.sourceHash) {
    throw fail('Embedded cache parent bytes differ from their admitted source identity.');
  }
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(parentBytes);
  try {
    const { source, text: localText } = await readRetainedSemanticSourceSnapshot({ store: opened.store,
      partitionId: opened.factsRef.syntaxPartitionId, maxBytes: 64 * 1024 * 1024, signal });
    const map = await readRetainedEmbeddedSourceMap({ store: opened.store, source, parentFacts, signal });
    if (map.segmentUid !== segmentUid) throw fail('Embedded cache segment identity differs from its retained map.');
    assertRetainedEmbeddedSourceRange({ map, source, localText, parentText: text,
      parentSource: { repositoryNamespace: parentFacts.repositoryNamespace, sourceUnitId: parentFacts.sourceUnitId,
        byteHash: parentFacts.sourceHash, textLength: text.length } });
    return source;
  } catch (error) {
    if (['ERR_SEMANTIC_SOURCE_MISMATCH', 'ERR_EMBEDDED_SOURCE_MAP_CONTRACT', 'ERR_FILE_INTEGRITY'].includes(error.code)) {
      throw Object.assign(fail('Embedded cache source/map qualification failed.'), { cause: error });
    }
    throw error;
  }
};
