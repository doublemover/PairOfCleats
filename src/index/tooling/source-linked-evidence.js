import { createHash } from 'node:crypto';
import { canonicalSemanticJson, semanticHash, createAnalysisPartitionId } from '../semantic/identity.js';
import { writeSemanticAnalysis } from '../semantic/analysis-write.js';
import { persistSemanticEvidence } from '../semantic/lsp-evidence.js';
import { combineSemanticProviderOutputs } from './result-dispatch.js';
import { throwIfAborted } from '../../shared/abort.js';

const fail = message => Object.assign(new Error(message), { code: 'ERR_SOURCE_LINKED_EVIDENCE' });
const same = (left, right) => canonicalSemanticJson(left) === canonicalSemanticJson(right);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const validSpan = (span, item) => Array.isArray(span) && span.length === 2
  && span.every(value => Number.isSafeInteger(value) && value >= 0 && value <= item.source.textLength)
  && span[0] <= span[1] && span.every(offset => !(offset > 0 && offset < item.text.length
    && /[\uD800-\uDBFF]/u.test(item.text[offset - 1]) && /[\uDC00-\uDFFF]/u.test(item.text[offset])));

/** Persist source-linked observations in the existing evidence/analysis writer.
 * Evidence targets are bounded immutable source witnesses, not replacement
 * declarations, semantic bindings, resolver dispatch or complete coverage. */
export const writeSourceLinkedEvidence = async ({ report, sources, state, policy, semanticSink = null,
  maxBytes = 1024 * 1024, maxReferences = 4096, signal = null }) => {
  throwIfAborted(signal);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1024 * 1024
    || !Number.isSafeInteger(maxReferences) || maxReferences < 1 || maxReferences > 4096) throw fail('Invalid source-linked writer bounds.');
  const encoded = canonicalSemanticJson(report);
  if (Buffer.byteLength(encoded) > maxBytes) throw fail('Source-linked report byte budget exhausted.');
  report = JSON.parse(encoded);
  const { identity, ...identityInput } = report;
  if (report.schemaVersion !== 1 || report.kind !== 'source-linked-evidence'
    || !text(report.producerId) || !text(report.adapterVersion) || !text(report.method) || !text(report.evidenceKind)
    || !digest(identity) || semanticHash('tooling.source-linked-evidence.v1', identityInput) !== identity
    || !report.generation || !digest(report.project?.configHash) || !digest(report.project?.dependencyHash)
    || !text(report.runtime?.family) || !text(report.runtime?.version) || !text(report.runtime?.qualification)
    || (report.runtime.profileHash !== null && !digest(report.runtime.profileHash))
    || !(sources instanceof Map) || !Array.isArray(report.results) || !report.results.length || report.results.length > 20) throw fail('Invalid source-linked report identity.');
  const items = new Map(), seen = new Set();
  for (const result of report.results) {
    const item = sources.get(result.path), source = item?.source, current = state.semanticFactsByFile?.get(item?.file);
    if (!source || items.has(source.sourceUnitId) || result.sourceUnitId !== source.sourceUnitId
      || result.sourceHash !== source.byteHash || result.path !== source.path
      || !(item.bytes instanceof Uint8Array) || typeof item.text !== 'string'
      || createHash('sha256').update(item.bytes).digest('hex') !== source.byteHash
      || new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(item.bytes) !== item.text
      || !current || current.sourceUnitId !== source.sourceUnitId || current.sourceHash !== source.byteHash
      || current.syntaxPartitionId !== item.syntax?.partitionId || !same(current.storage, item.facts.storage)
      || !same(current.storage.generation, report.generation)
      || current.partitions.find(partition => partition.partitionId === item.syntax.partitionId)?.canonicalHash !== item.syntax.canonicalHash
      || !Array.isArray(result.references) || !Array.isArray(result.diagnostics) || result.diagnostics.length > 32
      || !['partial', 'complete', 'unsupported'].includes(result.state)) throw fail('Source-linked report input differs from its immutable parser handoff.');
    items.set(source.sourceUnitId, item);
    seen.add(result.path);
  }
  if (seen.size !== sources.size) throw fail('Source-linked report omits a supplied source dependency.');
  let referenceCount = 0;
  for (const result of report.results) {
    const item = items.get(result.sourceUnitId);
    for (const diagnostic of result.diagnostics) {
      if (!diagnostic || typeof diagnostic !== 'object') throw fail('Invalid source-linked diagnostic.');
      if (Object.hasOwn(diagnostic, 'span') && diagnostic.span !== null && !validSpan(diagnostic.span, item)) throw fail('Diagnostic range differs from its source snapshot.');
      if (Object.hasOwn(diagnostic, 'spans')) {
        if (!Array.isArray(diagnostic.spans) || diagnostic.spans.length > 8) throw fail('Diagnostic source span budget exhausted.');
        for (const witness of diagnostic.spans) {
          const targetItem = items.get(witness?.sourceUnitId);
          if (!targetItem || witness.path !== targetItem.source.path || witness.sourceHash !== targetItem.source.byteHash
            || !validSpan(witness.span, targetItem)) throw fail('Diagnostic witness differs from its dependency source snapshot.');
        }
      }
    }
    for (const reference of result.references) {
      if (++referenceCount > maxReferences || !validSpan(reference.span, item) || !text(reference.family)
        || !['resolved', 'unresolved'].includes(reference.state)) throw fail('Invalid source-linked reference or reference budget.');
      if (reference.target !== null) {
        const target = reference.target, targetItem = items.get(target?.sourceUnitId);
        if (!target || !targetItem || target.path !== targetItem.source.path || target.sourceHash !== targetItem.source.byteHash
          || !validSpan(target.span, targetItem) || reference.state !== 'resolved') throw fail('Reference target is outside its source/generation closure.');
      } else if (reference.state !== 'unresolved') throw fail('Resolved reference lacks a source witness.');
    }
  }
  const context = { contextKey: semanticHash('semantic.source-linked-context.v1', { identity, generation: report.generation }),
    providerId: report.producerId, providerVersion: report.adapterVersion, compilerVersion: report.runtime.version,
    configHash: report.project.configHash, moduleResolutionHash: report.project.dependencyHash,
    vfsMappingHash: semanticHash('semantic.source-linked-mappings.v1', [...items.values()].map(item => item.source.mapping)),
    sourceUnits: [...items.values()].map(item => ({ sourceUnitId: item.source.sourceUnitId, byteHash: item.source.byteHash })) };
  const partitions = [];
  const sidecar = { schemaVersion: 1, kind: 'source-linked-evidence-sidecar', report,
    sourcePartitions: [...items.values()].map(item => ({ sourceUnitId: item.source.sourceUnitId,
      sourceHash: item.source.byteHash, partitionId: item.syntax.partitionId })) };
  for (const result of report.results) {
    throwIfAborted(signal);
    const item = items.get(result.sourceUnitId);
    const artifactRef = await persistSemanticEvidence({ value: sidecar, stagingRoot: item.root,
      diskAccount: state.semanticDiskAccount, inventory: state.semanticEvidenceArtifacts, signal, maxBytes });
    const partitionId = createAnalysisPartitionId({ pass: { name: 'source-linked-evidence', version: '1' },
      inputPartitionHashes: [item.syntax.canonicalHash], compilerContext: context.contextKey,
      dependencySummaryHashes: [report.project.dependencyHash], analysisPolicy: { identity, source: item.source.sourceUnitId } });
    const rows = [{ family: 'node', row: { id: 0, kind: 'evidence', span: null, scope: null,
      data: { method: report.method, producerId: report.producerId, producerVersion: report.adapterVersion,
        evidenceKind: report.evidenceKind, sourceRef: item.source.sourceUnitId, artifactRef } } }];
    partitions.push(await writeSemanticAnalysis({ rows, policy, stagingRoot: item.root, source: item.source,
      sourceBytes: item.bytes, partitionId, contextHash: context.contextKey,
      producerHash: semanticHash('semantic.source-linked-producer.v1', report.runtime),
      policyHash: semanticHash('semantic.source-linked-policy.v1', { version: 1, authority: 'qualified-source-witness' }),
      structuralSlots: [], diskAccount: state.semanticDiskAccount, signal }));
  }
  const output = combineSemanticProviderOutputs([{ schemaVersion: 1, contexts: [context], partitions, coverageRef: null, diagnosticsRef: null }]);
  const admission = semanticSink ? await semanticSink(output, { signal }) : { accepted: 0, persisted: 0 };
  return { output, ...admission, emitted: partitions.length, references: referenceCount, identity };
};
