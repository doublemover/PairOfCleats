import path from 'node:path';
import { canonicalSemanticJson, semanticHash } from '../index/semantic/identity.js';
import { readVerifiedContainedFile } from '../shared/contained-file.js';
import { throwIfAborted } from '../shared/abort.js';

const fail = message => Object.assign(new Error(message), { code: 'ERR_SOURCE_LINKED_EVIDENCE' });

/** Bounded detail for source-linked schema/configuration observations. The
 * caller supplies stores from the same published generation for cross-source
 * target hydration; unverified targets remain explicit and non-navigable. */
export const readSourceLinkedEvidenceDetail = async ({ store, ref, evidenceRoot = store.storeId,
  targetStoreForSource = null, maxBytes = 1024 * 1024, maxReferences = 256, referenceOffset = 0, budget = null, signal = null }) => {
  throwIfAborted(signal);
  if (store.backend !== 'artifact' || path.resolve(evidenceRoot) !== path.resolve(store.storeId)
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1024 * 1024
    || !Number.isSafeInteger(maxReferences) || maxReferences < 1 || maxReferences > 4096
    || !Number.isSafeInteger(referenceOffset) || referenceOffset < 0 || referenceOffset > 4096) throw fail('Evidence root or detail bounds are not admitted.');
  const [record] = await store.getRecords([ref], ['data'], { signal });
  if (record?.kind !== 'evidence' || !['graphql-schema-references', 'configuration-local-references', 'template-local-references', 'proto-descriptor-references', 'shellcheck-diagnostics', 'sql-catalog-references', 'scala-semanticdb-references', 'astro-generated-references'].includes(record.data.evidenceKind)) throw fail('Record is not source-linked schema/configuration/template/diagnostic evidence.');
  const match = /^semantic-evidence\/([a-f0-9]{64})\.json$/u.exec(record.data.artifactRef || '');
  if (!match) throw fail('Invalid source-linked evidence reference.');
  const { buffer } = await readVerifiedContainedFile(evidenceRoot, path.join(evidenceRoot, record.data.artifactRef), { expectedHash: match[1], maxBytes, signal });
  budget?.consumeBytes(buffer.length);
  const sidecar = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
  const report = sidecar.report;
  if (sidecar.schemaVersion !== 1 || sidecar.kind !== 'source-linked-evidence-sidecar' || !report
    || !Array.isArray(sidecar.sourcePartitions) || sidecar.sourcePartitions.length > 20
    || !Array.isArray(report.results) || report.results.length > 20) throw fail('Invalid source-linked evidence framing.');
  const { identity, ...identityInput } = report;
  if (semanticHash('tooling.source-linked-evidence.v1', identityInput) !== identity) throw fail('Source-linked batch identity changed.');
  const results = report.results.filter(value => value.sourceUnitId === record.data.sourceRef);
  if (results.length !== 1) throw fail('Source-linked evidence does not uniquely identify its source.');
  const result = results[0], sourcePartitions = new Map();
  for (const item of sidecar.sourcePartitions) {
    if (!item || sourcePartitions.has(item.sourceUnitId) || !/^su1:[a-f0-9]{64}$/u.test(item.sourceUnitId)
      || !/^[a-f0-9]{64}$/u.test(item.sourceHash) || !/^sy1:[a-f0-9]{64}$/u.test(item.partitionId)) throw fail('Invalid target partition inventory.');
    sourcePartitions.set(item.sourceUnitId, item);
  }
  let source = null;
  for await (const manifest of store.iterateRows(ref.partitionId, 'semantic_sources', { signal })) {
    if (source) throw fail('Multiple evidence source manifests.');
    source = manifest;
  }
  if (!source || report.schemaVersion !== 1 || report.kind !== 'source-linked-evidence'
    || !Array.isArray(result.references) || result.references.length > 4096
    || !Array.isArray(result.diagnostics) || result.diagnostics.length > 32
    || result.path !== source.path || record.data.sourceRef !== source.sourceUnitId || result.sourceHash !== source.byteHash
    || report.method !== record.data.method || report.evidenceKind !== record.data.evidenceKind
    || report.producerId !== record.data.producerId || report.adapterVersion !== record.data.producerVersion
    || canonicalSemanticJson(report.generation) !== canonicalSemanticJson(store.generation)) throw fail('Evidence source/generation identity differs from its canonical record.');
  const sourceSpans = [...result.references.map(reference => reference?.span),
    ...result.diagnostics.filter(diagnostic => diagnostic?.span != null).map(diagnostic => diagnostic.span),
    ...result.references.filter(reference => reference?.target?.sourceUnitId === source.sourceUnitId).map(reference => reference.target.span)];
  await store.verifySource(source, { signal, spans: sourceSpans });
  const navigationCandidates = [], unresolvedTargets = [], verified = new Set([source.sourceUnitId + ':' + source.byteHash]);
  const selectedReferences = result.references.slice(referenceOffset, referenceOffset + maxReferences), targetSpans = new Map();
  for (const reference of selectedReferences) if (reference.state === 'resolved' && reference.target) {
    if (!targetSpans.has(reference.target.sourceUnitId)) targetSpans.set(reference.target.sourceUnitId, []);
    targetSpans.get(reference.target.sourceUnitId).push(reference.target.span);
  }
  for (const reference of selectedReferences) {
    throwIfAborted(signal);
    if (reference.state !== 'resolved' || !reference.target) continue;
    const target = reference.target, targetStore = targetStoreForSource ? await targetStoreForSource(target.sourceUnitId)
      : target.sourceUnitId === source.sourceUnitId ? store : null;
    if (!targetStore || canonicalSemanticJson(targetStore.generation) !== canonicalSemanticJson(store.generation)) {
      unresolvedTargets.push({ target, reason: 'target_generation_unavailable' }); continue;
    }
    let targetSource = null;
    const targetPartition = sourcePartitions.get(target.sourceUnitId);
    if (!targetPartition || targetPartition.sourceHash !== target.sourceHash) throw fail('Source-linked target identity differs from its host partition inventory.');
    for await (const candidate of targetStore.iterateRows(targetPartition.partitionId, 'semantic_sources', { signal })) {
      if (targetSource) throw fail('Conflicting target manifests.');
      targetSource = candidate;
    }
    if (!targetSource || targetSource.sourceUnitId !== target.sourceUnitId || targetSource.byteHash !== target.sourceHash || targetSource.path !== target.path
      || targetSource.repositoryNamespace !== source.repositoryNamespace || !Array.isArray(target.span) || target.span.length !== 2
      || !target.span.every(value => Number.isSafeInteger(value) && value >= 0 && value <= targetSource.textLength)
      || target.span[0] > target.span[1]) { unresolvedTargets.push({ target, reason: 'target_source_unavailable' }); continue; }
    const key = targetSource.sourceUnitId + ':' + targetSource.byteHash;
    if (!verified.has(key)) { await targetStore.verifySource(targetSource, { signal, spans: targetSpans.get(target.sourceUnitId) }); verified.add(key); }
    navigationCandidates.push({ ...target, evidenceRef: ref, family: reference.family, fromSpan: reference.span,
      coverage: 'source_qualified_observation' });
  }
  return { recordRef: ref, generation: store.generation, source, report, result, navigationCandidates, unresolvedTargets,
    partial: result.state !== 'complete' || referenceOffset > 0 || result.references.length > referenceOffset + maxReferences || unresolvedTargets.length > 0,
    omittedReferences: Math.max(0, result.references.length - referenceOffset - maxReferences) };
};
