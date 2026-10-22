import { createHash } from 'node:crypto';
import { canonicalSemanticJson, semanticHash, createAnalysisPartitionId, createSymbolGroupId } from '../semantic/identity.js';
import { exactLspRange } from '../semantic/lsp-locations.js';
import { writeSemanticAnalysis } from '../semantic/analysis-write.js';
import { persistSemanticEvidence } from '../semantic/lsp-evidence.js';
import { combineSemanticProviderOutputs } from './result-dispatch.js';
import { throwIfAborted } from '../../shared/abort.js';
import path from 'node:path';
import { createArtifactSemanticStore } from '../../semantic/artifact-store.js';
import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';
import { readVerifiedContainedFile } from '../../shared/contained-file.js';

const fail = message => Object.assign(new Error(message), { code: 'ERR_SCIP_IMPORT_IDENTITY' });
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const field = (object, camel, snake) => {
  if (object?.[camel] !== undefined && object?.[snake] !== undefined
    && canonicalSemanticJson(object[camel]) !== canonicalSemanticJson(object[snake])) throw fail('Conflicting SCIP JSON field spelling.');
  return object?.[camel] ?? object?.[snake];
};
const encoding = value => ({ 1: 'utf-8', 2: 'utf-16', 3: 'utf-32',
  UTF8CodeUnitOffsetFromLineStart: 'utf-8', UTF16CodeUnitOffsetFromLineStart: 'utf-16',
  UTF32CodeUnitOffsetFromLineStart: 'utf-32' })[value] || null;
const strictPath = value => typeof value === 'string' && value && !value.includes('\\') && !value.includes(':')
  && !value.startsWith('/') && !value.includes('\0') && value.split('/').every(part => part && part !== '.' && part !== '..');
const protocolRange = value => {
  if (!Array.isArray(value) || ![3, 4].includes(value.length) || value.some(part => !Number.isSafeInteger(part) || part < 0)) return null;
  return { start: { line: value[0], character: value[1] }, end: {
    line: value.length === 3 ? value[0] : value[2], character: value.at(-1)
  } };
};

/** Build adapter inputs from the immutable parser handoff, never from a
 * producer-supplied declaration inventory or freshly read working-tree text. */
export const loadScipSemanticSources = async ({ state, runtime, maxSources = 256, maxBytes = 1048576, signal = null }) => {
  const sources = new Map();
  let retainedBytes = 0, retainedTargets = 0;
  if (!Number.isSafeInteger(maxSources) || maxSources < 1 || maxSources > 1024
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16 * 1048576) throw fail('Invalid SCIP source inventory bound.');
  for (const [file, facts] of state.semanticFactsByFile || []) {
    throwIfAborted(signal);
    if (sources.size >= maxSources) throw fail('SCIP source inventory budget exhausted.');
    const root = path.join(runtime.buildRoot, facts.storage.relativePath), syntax = facts.partitions.find(value => value.partitionId === facts.syntaxPartitionId);
    const store = createArtifactSemanticStore({ root, repoRoot: runtime.root, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      generation: facts.storage.generation, partitions: facts.partitions });
    let source;
    for await (const row of store.iterateRows(syntax.partitionId, 'semantic_sources', { signal })) {
      if (source) throw fail('Multiple SCIP parser source manifests.');
      source = row;
    }
    if (!source || source.encoding !== 'utf8') continue;
    await store.verifySource(source, { signal });
    const { buffer: bytes } = await readVerifiedContainedFile(root, path.join(root, 'semantic-sources', source.byteHash + '.utf8'), {
      expectedHash: source.byteHash, maxBytes: maxBytes - retainedBytes, signal
    });
    retainedBytes += bytes.length;
    const declarations = [], occurrences = [];
    for await (const row of store.iterateRows(syntax.partitionId, 'semantic_records', { signal })) {
      const item = { span: row.span, ref: { partitionId: syntax.partitionId, localId: row.id } };
      if (row.span && row.kind === 'declaration') declarations.push(item);
      if (row.span && row.kind === 'occurrence') occurrences.push(item);
      if (declarations.length + occurrences.length + retainedTargets > 16384) throw fail('SCIP parser target budget exhausted.');
    }
    retainedTargets += declarations.length + occurrences.length;
    if (sources.has(source.path)) throw fail('Compile variants require separate explicit SCIP source mappings.');
    sources.set(source.path, { file, source, syntax, facts, root, bytes,
      text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), declarations, occurrences });
  }
  return sources;
};

/** A rich JSON SCIP bridge under existing semantic contracts. The producing
 * receipt is independently retained input authority, not a fresh file hash
 * masquerading as evidence that an older index matches today's working tree. */
export const prepareScipSemanticImport = ({ bytes, producingReceipt, expectedReceiptHash,
  generation, repositoryNamespace, projectVariant, producerRoot, admittedSources,
  maxBytes = 1048576, maxDocuments = 256, maxOccurrences = 4096, signal = null }) => {
  throwIfAborted(signal);
  for (const [value, maximum] of [[maxBytes, 16 * 1048576], [maxDocuments, 1024], [maxOccurrences, 16384]]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw fail('Invalid SCIP import bound.');
  }
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > maxBytes) throw fail('SCIP artifact byte budget exhausted.');
  const artifactHash = createHash('sha256').update(bytes).digest('hex');
  let index;
  try { index = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw fail('Only bounded complete UTF-8 SCIP JSON indexes are supported; binary/JSONL need an admitted converter profile.'); }
  if (!index || !Array.isArray(index.documents) || !index.metadata || index.documents.length > maxDocuments) throw fail('Malformed or oversized SCIP index framing.');
  if (!producingReceipt || !digest(expectedReceiptHash)) return { status: 'non-authoritative', reason: 'source_receipt_unavailable', artifactHash,
    documents: [], rejected: 0, omitted: index.documents.reduce((count, doc) => count + (doc.occurrences?.length || 0), 0) };
  if (semanticHash('tooling.scip-producing-receipt.v1', producingReceipt) !== expectedReceiptHash
    || producingReceipt.schemaVersion !== 1 || producingReceipt.artifactHash !== artifactHash
    || !digest(producingReceipt.profileHash) || producingReceipt.repositoryNamespace !== repositoryNamespace
    || canonicalSemanticJson(producingReceipt.generation) !== canonicalSemanticJson(generation)
    || canonicalSemanticJson(producingReceipt.projectVariant) !== canonicalSemanticJson(projectVariant)
    || producingReceipt.producerRoot !== producerRoot
    || field(index.metadata, 'projectRoot', 'project_root') !== producerRoot) throw fail('SCIP artifact/profile/root/build/source receipt mismatch.');
  const snapshots = new Map();
  for (const source of producingReceipt.sources || []) {
    if (!strictPath(source.documentPath) || snapshots.has(source.documentPath)) throw fail('Conflicting SCIP document/source mapping.');
    snapshots.set(source.documentPath, source);
  }
  const documents = [], definitions = new Map(), seen = new Set(), sourceIds = new Set();
  let occurrenceCount = 0, rejected = 0, omitted = 0, unsupportedRelationships = 0;
  for (const doc of index.documents) {
    throwIfAborted(signal);
    const documentPath = field(doc, 'relativePath', 'relative_path');
    if (!strictPath(documentPath) || seen.has(documentPath)) throw fail('SCIP document path escapes or conflicts with its root mapping.');
    seen.add(documentPath);
    const receipt = snapshots.get(documentPath), item = admittedSources.get(documentPath);
    if (!receipt || !item || receipt.sourceUnitId !== item.source.sourceUnitId || receipt.byteHash !== item.source.byteHash
      || receipt.syntaxPartitionId !== item.syntax.partitionId || receipt.syntaxHash !== item.syntax.canonicalHash
      || receipt.mappingIdentity !== (item.source.mapping?.identity ?? null)
      || item.source.repositoryNamespace !== repositoryNamespace) throw fail('SCIP source bytes/syntax/generated mapping lack producing-snapshot authority.');
    if (sourceIds.has(item.source.sourceUnitId)) throw fail('Multiple SCIP documents map to one admitted source.');
    sourceIds.add(item.source.sourceUnitId);
    if (!(item.bytes instanceof Uint8Array) || createHash('sha256').update(item.bytes).digest('hex') !== item.source.byteHash
      || new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(item.bytes) !== item.text
      || canonicalSemanticJson(item.facts.storage.generation) !== canonicalSemanticJson(generation)) throw fail('SCIP admitted bytes or generation changed.');
    if (doc.text !== undefined && doc.text !== item.text) throw fail('Embedded SCIP document text differs from its producing snapshot.');
    const positionEncoding = encoding(field(doc, 'positionEncoding', 'position_encoding'));
    if (!positionEncoding) throw fail('SCIP document position encoding is ambiguous or unsupported.');
    if (!Array.isArray(doc.occurrences) || !Array.isArray(doc.symbols || [])) throw fail('Malformed SCIP document members.');
    const symbols = new Map();
    for (const symbol of doc.symbols || []) {
      if (!symbol || typeof symbol.symbol !== 'string' || !symbol.symbol) throw fail('Malformed SCIP symbol information.');
      if (symbols.has(symbol.symbol) && canonicalSemanticJson(symbols.get(symbol.symbol)) !== canonicalSemanticJson(symbol)) throw fail('Conflicting SCIP symbol information.');
      symbols.set(symbol.symbol, symbol);
      unsupportedRelationships += Array.isArray(symbol.relationships) ? symbol.relationships.length : 0;
    }
    const occurrences = [];
    for (const occurrence of doc.occurrences) {
      if (++occurrenceCount > maxOccurrences) throw fail('SCIP occurrence budget exhausted.');
      const range = protocolRange(occurrence.range), symbol = occurrence.symbol;
      const roles = field(occurrence, 'symbolRoles', 'symbol_roles') ?? 0;
      if (!range || typeof symbol !== 'string' || !symbol || symbol.length > 16384 || !Number.isSafeInteger(roles) || roles < 0) { rejected++; continue; }
      const span = exactLspRange(item.source, item.text, range, positionEncoding);
      if (!span || span[0] === span[1] || item.source.mapping && item.source.mapping.quality !== 'exact') { rejected++; continue; }
      const symbolKey = semanticHash('tooling.scip-symbol.v1', { artifactHash, generation, projectVariant,
        localSource: symbol.startsWith('local ') ? item.source.sourceUnitId : null, symbol });
      const normalized = { symbol, symbolKey, span, roles, original: occurrence,
        declarationRefs: item.declarations.filter(value => value.span[0] <= span[0] && value.span[1] >= span[1]).slice(0, 2).map(value => value.ref),
        occurrenceRefs: item.occurrences.filter(value => value.span[0] === span[0] && value.span[1] === span[1]).slice(0, 2).map(value => value.ref) };
      if (roles & 1) {
        const known = definitions.get(symbolKey) || [];
        for (const ref of normalized.declarationRefs) if (!known.some(value => canonicalSemanticJson(value) === canonicalSemanticJson(ref))) known.push(ref);
        definitions.set(symbolKey, known);
      }
      if (roles & ~127) omitted++;
      occurrences.push(normalized);
    }
    documents.push({ item, documentPath, positionEncoding, symbols, occurrences, original: doc });
  }
  return { status: rejected || omitted || unsupportedRelationships ? 'partial' : 'admitted', artifactHash,
    profileHash: producingReceipt.profileHash, generation, projectVariant, metadata: index.metadata,
    documents, definitions, rejected, omitted, unsupportedRelationships,
    externalSymbols: field(index, 'externalSymbols', 'external_symbols') || [] };
};

/** Materialize supported definition/reference observations through the existing
 * writer and return one canonical provider envelope for the common sink. */
export const writeScipSemanticImport = async ({ prepared, state, policy, semanticSink = null, signal = null }) => {
  if (!['admitted', 'partial'].includes(prepared.status)) return { status: prepared.status, output: null, accepted: 0, persisted: 0 };
  const contexts = [], partitions = [];
  let unjoined = 0;
  for (const document of prepared.documents) {
    throwIfAborted(signal);
    const { item } = document;
    const context = { contextKey: semanticHash('semantic.scip-context.v1', { profileHash: prepared.profileHash,
      artifactHash: prepared.artifactHash, generation: prepared.generation, variant: prepared.projectVariant }),
    sourceUnits: prepared.documents.map(value => ({ sourceUnitId: value.item.source.sourceUnitId, byteHash: value.item.source.byteHash })),
    providerId: 'scip-import', providerVersion: '1', compilerVersion: null,
    configHash: semanticHash('semantic.scip-project.v1', { metadata: prepared.metadata, variant: prepared.projectVariant }),
    moduleResolutionHash: prepared.profileHash, vfsMappingHash: semanticHash('semantic.scip-mappings.v1', prepared.documents.map(value => value.item.source.mapping)) };
    const partitionId = createAnalysisPartitionId({ pass: { name: 'scip-import', version: '1' },
      inputPartitionHashes: [item.syntax.canonicalHash], compilerContext: context.contextKey,
      dependencySummaryHashes: [prepared.profileHash], analysisPolicy: { artifactHash: prepared.artifactHash, source: item.source.sourceUnitId } });
    const artifactRef = await persistSemanticEvidence({ value: { schemaVersion: 1, format: 'SCIP-JSON', metadata: prepared.metadata,
      profileHash: prepared.profileHash, artifactHash: prepared.artifactHash, generation: prepared.generation,
      sourceUnitId: item.source.sourceUnitId, sourceHash: item.source.byteHash, document: document.original,
      externalSymbols: prepared.externalSymbols,
      unsupportedRelationshipCount: [...document.symbols.values()].reduce((count, value) => count + (value.relationships?.length || 0), 0) },
    stagingRoot: item.root, diskAccount: state.semanticDiskAccount, inventory: state.semanticEvidenceArtifacts, signal });
    const rows = [], names = new Map();
    let nodeId = 0, edgeId = 0;
    const nameId = text => { if (!names.has(text)) names.set(text, names.size); return names.get(text); };
    const ref = localId => ({ partitionId, localId });
    for (const occurrence of document.occurrences) {
      const evidence = ref(nodeId++);
      rows.push({ family: 'node', row: { id: evidence.localId, kind: 'evidence', span: occurrence.span, scope: null,
        data: { method: 'scip/occurrence', producerId: 'scip-import', producerVersion: '1', evidenceKind: 'scip-source-pinned', sourceRef: item.source.sourceUnitId, artifactRef } } });
      const candidates = prepared.definitions.get(occurrence.symbolKey) || [];
      if (occurrence.roles & 1) {
        for (const target of candidates) rows.push({ family: 'edge', row: { id: edgeId++, kind: 'evidenceInput', from: evidence, to: target,
          callSite: null, operandOrdinal: null, contextKey: context.contextKey, condition: null, evidence, certainty: 'modeled' } });
        continue;
      }
      if (occurrence.occurrenceRefs.length !== 1) { unjoined++; continue; }
      const targets = [...candidates];
      if (!targets.length) {
        const external = ref(nodeId++); targets.push(external);
        rows.push({ family: 'node', row: { id: external.localId, kind: 'externalDeclaration', span: null, scope: null,
          data: { contextKey: context.contextKey, uri: 'scip:' + encodeURIComponent(occurrence.symbol), packageName: null,
            packageVersion: null, nameId: nameId(occurrence.symbol), declarationKind: 'scip-symbol', sourceHash: null, sourceRange: null } } });
      }
      const binding = ref(nodeId++), resolved = candidates.length === 1;
      rows.push({ family: 'node', row: { id: binding.localId, kind: 'binding', span: occurrence.span, scope: null,
        data: { occurrence: occurrence.occurrenceRefs[0], contextKey: context.contextKey,
          status: candidates.length > 1 ? 'ambiguous' : resolved ? 'resolved' : 'heuristic', signature: null,
          symbolGroupId: createSymbolGroupId({ contextKey: context.contextKey, declarations: targets }), candidateCount: targets.length } } });
      for (const target of targets) for (const [kind, from] of [['bindingCandidate', binding], ['references', occurrence.occurrenceRefs[0]]]) rows.push({
        family: 'edge', row: { id: edgeId++, kind, from, to: target, callSite: null, operandOrdinal: null,
          contextKey: context.contextKey, condition: null, evidence, certainty: resolved ? 'exact-static' : 'modeled' }
      });
    }
    rows.push(...[...names].map(([value, id]) => ({ family: 'lookup', row: { kind: 'name', id, value } })));
    const partition = await writeSemanticAnalysis({ rows, policy, stagingRoot: item.root, source: item.source, sourceBytes: item.bytes,
      partitionId, producerHash: prepared.profileHash, contextHash: context.contextKey, policyHash: semanticHash('semantic.scip-policy.v1', { version: 1 }),
      structuralSlots: [], diskAccount: state.semanticDiskAccount, signal });
    contexts.push(context); partitions.push(partition);
  }
  const output = combineSemanticProviderOutputs([{ schemaVersion: 1, contexts, partitions, coverageRef: null, diagnosticsRef: null }]);
  const admission = semanticSink ? await semanticSink(output, { signal }) : { accepted: 0, persisted: 0 };
  return { status: prepared.status, output, ...admission, emitted: partitions.length,
    rejected: prepared.rejected, omitted: prepared.omitted + unjoined, unsupportedRelationships: prepared.unsupportedRelationships };
};
