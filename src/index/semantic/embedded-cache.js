import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openSemanticCacheEntry, persistSemanticCacheEntry, relocateSemanticCacheEntry } from '../build/incremental/semantic-cache.js';
import { resolveSemanticPartPath } from '../../semantic/artifact-store.js';
import { semanticHash } from './identity.js';
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
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(parentBytes);
  let source;
  for await (const row of opened.store.iterateRows(opened.factsRef.syntaxPartitionId,'semantic_sources',{signal})) source = row;
  if (!source?.mapping || source.mapping.parentSourceUnitId !== parentFacts.sourceUnitId) throw fail('Embedded cache belongs to another parent or duplicates a source.');
  const mapBytes = await fs.readFile(await resolveSemanticPartPath(opened.root, source.mapping.mapRef)), map = JSON.parse(mapBytes.toString('utf8'));
  if (createHash('sha256').update(mapBytes).digest('hex') !== path.basename(source.mapping.mapRef,'.json') || semanticHash('semantic.embedded-map.v1',map) !== source.mapping.identity
      || map.parentByteHash !== parentFacts.sourceHash || map.parentSourceUnitId !== parentFacts.sourceUnitId || map.segmentUid !== segmentUid
      || !Number.isSafeInteger(map.parentStart) || !Number.isSafeInteger(map.parentEnd) || map.parentStart < 0 || map.parentEnd > text.length || map.parentStart >= map.parentEnd) throw fail('Embedded source mapping identity/range mismatch.');
  await opened.store.verifySource(source,{signal});
  const local = await fs.readFile(await resolveSemanticPartPath(opened.root,'semantic-sources/' + source.byteHash + '.utf8'));
  if (source.mapping.quality === 'exact' && Buffer.from(text.slice(map.parentStart,map.parentEnd),'utf8').compare(local) !== 0) throw fail('Embedded source differs from its exact parent slice.');
  return source;
};
