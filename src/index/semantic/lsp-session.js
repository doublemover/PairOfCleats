import { SEMANTIC_ANALYSIS_VERSIONS } from './analysis-versions.js';
import { collectSemanticTargetScopes, resolveSemanticSourcePolicy, semanticTargetMatchesRecord, semanticPhasePolicy } from './policy.js';
import { planSemanticSource } from './planning.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { resolveSemanticPartPath } from '../../semantic/artifact-store.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createArtifactSemanticStore } from '../../semantic/artifact-store.js';
import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';
import { assertSemanticEnvelope } from '../../contracts/validators/semantic-envelopes.js';
import { createAnalysisPartitionId, createSymbolGroupId, semanticHash, canonicalSemanticJson } from './identity.js';
import { writeSemanticAnalysis } from './analysis-write.js';
import { persistSemanticEvidence } from './lsp-evidence.js';
import { exactLspRange, normalizeLspLocations, offsetToLspPosition } from './lsp-locations.js';
import { throwIfAborted } from '../../shared/abort.js';
const keyPath = file => { const value = path.resolve(file); return process.platform === 'win32' ? value.toLowerCase() : value; };
const refKey = ref => canonicalSemanticJson(ref);
/** One build-owned LSP lane; this owns no server, Program, or request scheduler. */
export const createSemanticLspSession = async ({ state, runtime, signal = null }) => {
  const inventory = new Map(), byUri = new Map(), texts = new Map(), emitted = [], contexts = new Map(), completed = new Set();
  const policy = runtime.semanticPolicy;
  state.semanticEvidenceArtifacts ||= [];
  for (const [file, facts] of state.semanticFactsByFile || []) {
    throwIfAborted(signal);
    const root = path.join(runtime.buildRoot, facts.storage.relativePath);
    const store = createArtifactSemanticStore({ root, repoRoot: runtime.root, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation: facts.storage.generation, partitions: facts.partitions });
    const syntax = facts.partitions.find(partition => partition.partitionId === facts.syntaxPartitionId);
    let source;
    for await (const row of store.iterateRows(syntax.partitionId, 'semantic_sources', { signal })) source = row;
    if (!source) continue;
    await store.verifySource(source, { signal });
    const bytes = await fs.readFile(path.join(root, 'semantic-sources', source.byteHash + '.utf8'));
    const occurrenceIds = new Set();
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), declarations = [];
    for await (const row of store.iterateRows(syntax.partitionId, 'semantic_records', { signal })) { if (row.kind === 'declaration' && row.span) declarations.push({ span: row.span, ref: { partitionId: syntax.partitionId, localId: row.id } }); if (row.kind === 'occurrence' && row.span && !row.data.roles.includes('definition')) occurrenceIds.add(refKey({ partitionId: syntax.partitionId, localId: row.id })); }
    const resolved = new Set();
    for (const partition of facts.partitions) if (partition.partitionId !== syntax.partitionId) for await (const row of store.iterateRows(partition.partitionId, 'semantic_records', { signal })) if (row.kind === 'binding' && row.data.status === 'resolved') resolved.add(refKey(row.data.occurrence));
    const unresolvedCount = [...occurrenceIds].filter(key => !resolved.has(key)).length;
    let sourceMap = null;
    if (source.mapping) {
      if (!/^semantic-evidence\/[a-f0-9]{64}\.json$/.test(source.mapping.mapRef)) throw new Error('Invalid embedded mapping sidecar path.');
      const mapBytes = await fs.readFile(await resolveSemanticPartPath(root, source.mapping.mapRef));
      if (createHash('sha256').update(mapBytes).digest('hex') !== path.basename(source.mapping.mapRef, '.json')) throw new Error('Embedded mapping sidecar hash mismatch.');
      sourceMap = JSON.parse(mapBytes.toString('utf8'));
      if (semanticHash('semantic.embedded-map.v1', sourceMap) !== source.mapping.identity || sourceMap.parentSourceUnitId !== source.mapping.parentSourceUnitId || sourceMap.localEnd !== source.textLength) throw new Error('Embedded map identity mismatch.');
    }
    const sourcePath = source.mapping ? [...state.semanticFactsByFile].find(([, parent]) => parent.sourceUnitId === source.mapping.parentSourceUnitId)?.[0] || source.path : source.path;
    const sourcePolicy = resolveSemanticSourcePolicy(policy, { sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash, language: source.language, path: sourcePath });
    const plan = state.semanticPlanningBySource?.get(source.sourceUnitId) || planSemanticSource(sourcePolicy, { sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash, syntaxPartitionId: syntax.partitionId });
    const item = { sourceMap, policy: sourcePolicy, plan, unresolvedCount, file, facts, root, store, syntax, source, text, bytes, declarations, resolved };
    inventory.set(source.sourceUnitId, item);
    if (!source.mapping) { texts.set(source.path, text); byUri.set(pathToFileURL(path.join(runtime.root, source.path)).href, item); }
  }
  const itemForDoc = doc => {
    if (doc.semanticSourceUnitId && !doc.segmentUid) { const item = inventory.get(doc.semanticSourceUnitId); if (!item?.source.mapping) return item; }
    const container = keyPath(path.resolve(runtime.root, doc.containerPath || doc.virtualPath));
    if (doc.segmentUid) return [...inventory.values()].find(item => {
      const parent = inventory.get(item.source.mapping?.parentSourceUnitId);
      return parent && item.sourceMap?.segmentUid === doc.segmentUid && keyPath(path.resolve(runtime.root, parent.source.path)) === container && item.sourceMap?.parentStart === doc.segmentRange?.start && item.sourceMap?.parentEnd === doc.segmentRange?.end && item.text === doc.text;
    });
    return [...inventory.values()].find(item => !item.source.mapping && keyPath(path.resolve(runtime.root, item.source.path)) === container);
  };
  const api = {
    get enabled() { return inventory.size > 0; }, get hasTargetedWork() { return [...inventory.values()].some(item => item.unresolvedCount > 0); }, fileTextByFile: texts,
    setSignal(value) { signal = value; },
    prepareDocuments(documents) {
      const result = documents.map(doc => { const item = itemForDoc(doc); return item ? { ...doc, semanticSourceUnitId: item.source.sourceUnitId } : doc; }), present = new Set(result.map(doc => itemForDoc(doc)?.source.sourceUnitId));
      for (const item of inventory.values()) if (!item.source.mapping && !present.has(item.source.sourceUnitId)) result.push({ virtualPath: item.source.path, containerPath: item.source.path, languageId: item.source.language, effectiveExt: path.extname(item.source.path), text: item.text, docHash: item.source.textHash, lineIndex: item.source.lineStarts, segmentUid: null, segmentRange: { start: 0, end: item.source.textLength }, semanticSourceUnitId: item.source.sourceUnitId });
      return result;
    },
    registerDocument(doc, uri) {
      const item = itemForDoc(doc);
      if (!item) return;
      if (doc.text !== item.text) throw Object.assign(new Error('LSP document differs from immutable semantic source.'), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
      byUri.set(uri, item);
    },
    async targetsForDocument(doc) {
      const item = itemForDoc(doc); if (!item) return [];
      if (state.semanticAdmittedSources && !state.semanticAdmittedSources.has(item.source.sourceUnitId)) return [];
      if (!semanticPhasePolicy(item.policy, item.plan, 'bindings', runtime, item.source.sourceUnitId).admitted && !state.semanticAdmittedSources?.has(item.source.sourceUnitId)) return [];
      if (doc.text !== item.text) throw Object.assign(new Error('LSP source snapshot mismatch.'), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
      const current = state.semanticFactsByFile.get(item.file);
      if (current && current.canonicalHash !== item.facts.canonicalHash) {
        const refreshed = createArtifactSemanticStore({ root: item.root, repoRoot: runtime.root, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation: current.storage.generation, partitions: current.partitions });
        for (const partition of current.partitions) if (partition.partitionId !== item.syntax.partitionId) for await (const row of refreshed.iterateRows(partition.partitionId, 'semantic_records', { signal })) if (row.kind === 'binding' && row.data.status === 'resolved') item.resolved.add(refKey(row.data.occurrence));
        item.facts = current;
      }
      const targets = [], selectedScopes = await collectSemanticTargetScopes({ policy: item.policy, store: item.store, partitionId: item.syntax.partitionId, signal });
      for await (const row of item.store.iterateRows(item.syntax.partitionId, 'semantic_records', { signal })) {
        if (row.kind !== 'occurrence' || !row.span || row.data.roles.includes('definition')) continue;
        if (!semanticTargetMatchesRecord(item.policy, item.syntax.partitionId, row, selectedScopes)) continue;
        const ref = { partitionId: item.syntax.partitionId, localId: row.id };
        if (!item.resolved.has(refKey(ref))) targets.push({ ref, span: row.span, scope: row.scope, roles: row.data.roles, name: item.text.slice(...row.span) });
      }
      return targets;
    },
    async collectDocument({ doc, uri, requestDefinition, positionEncoding = 'utf-16', providerId = 'lsp', providerVersion = '1', workspaceKey = null, definitionEnabled = true, targets = null }) {
      const item = itemForDoc(doc); if (!item) return;
      const policy = item.policy;
      if (state.semanticAdmittedSources && !state.semanticAdmittedSources.has(item.source.sourceUnitId)) return;
      if (!semanticPhasePolicy(policy, item.plan, 'bindings', runtime, item.source.sourceUnitId).admitted && !state.semanticAdmittedSources?.has(item.source.sourceUnitId)) return;
      api.registerDocument(doc, uri);
      const context = { providerId, providerVersion, compilerVersion: null,
        configHash: semanticHash('semantic.lsp-config.v1', { providerId, providerVersion, workspaceKey, positionEncoding }),
        moduleResolutionHash: semanticHash('semantic.lsp-sources.v1', [...inventory.values()].map(value => ({ sourceUnitId: value.source.sourceUnitId, byteHash: value.source.byteHash })).sort((a,b) => a.sourceUnitId.localeCompare(b.sourceUnitId))),
        vfsMappingHash: semanticHash('semantic.lsp-mapping.v1', { uri, mapping: item.source.mapping }) };
      context.contextKey = semanticHash('semantic.lsp-context.v1', context);
      context.sourceUnits = [{ sourceUnitId: item.source.sourceUnitId, byteHash: item.source.byteHash }];
      const completionKey = context.contextKey + ':' + item.source.sourceUnitId;
      if (completed.has(completionKey)) return;
      const observations = [];
      for (const target of targets || await api.targetsForDocument(doc)) {
        throwIfAborted(signal);
        const position = offsetToLspPosition(item.source, item.text, target.span[0], positionEncoding);
        const response = definitionEnabled ? await requestDefinition({ name: target.name }, position) : { attempted: false, skipReason: 'definition_unsupported' };
        observations.push({ target, position, response: response || { attempted: true, payload: null } });
      }
      const partitionId = createAnalysisPartitionId({ pass: { name: 'lsp-bindings', version: SEMANTIC_ANALYSIS_VERSIONS.lspBindings }, inputPartitionHashes: [item.syntax.canonicalHash], compilerContext: context.contextKey, dependencySummaryHashes: [context.moduleResolutionHash], analysisPolicy: { policy: item.policy.identity.analysis, evidence: semanticHash('semantic.lsp-responses.v1', observations) } });
      const ref = localId => ({ partitionId, localId }), rows = [], names = new Map(); let nextId = 0, edgeId = 0, completedCount = 0, failed = false, deferred = false;
      const intern = value => { if (!names.has(value)) names.set(value, names.size); return names.get(value); };
      for (const { target, position, response } of observations) {
        const artifactRef = await persistSemanticEvidence({ value: { schemaVersion: 1, method: 'textDocument/definition', providerId, providerVersion, contextKey: context.contextKey,
          sourceUnitId: item.source.sourceUnitId, sourceHash: item.source.byteHash, positionEncoding, uri, position, payload: response.payload ?? null,
          attempted: response.attempted === true, error: response.error || null, skipReason: response.skipReason || null }, stagingRoot: item.root, diskAccount: state.semanticDiskAccount, inventory: state.semanticEvidenceArtifacts, signal });
        const evidence = ref(nextId++); rows.push({ family: 'node', row: { id: evidence.localId, kind: 'evidence', span: target.span, scope: target.scope,
          data: { method: 'textDocument/definition', producerId: providerId, producerVersion: providerVersion, evidenceKind: 'lsp-location', sourceRef: item.source.sourceUnitId, artifactRef } } });
        const candidates = [], exact = [];
        for (const location of normalizeLspLocations(response.payload)) {
          let mapped = byUri.get(location.uri);
          if (!mapped && location.uri?.startsWith('file:')) { try { const file = keyPath(fileURLToPath(location.uri)); mapped = [...inventory.values()].find(value => !value.source.mapping && keyPath(path.join(runtime.root, value.source.path)) === file); } catch { /* Not a recognized source URI. */ } }
          const span = mapped ? exactLspRange(mapped.source, mapped.text, location.range, positionEncoding) : null;
          const originSpan = location.originRange ? exactLspRange(item.source, item.text, location.originRange, positionEncoding) : target.span;
          const origin = originSpan && originSpan[0] <= target.span[0] && originSpan[1] >= target.span[1];
          const declarations = span && origin ? mapped.declarations.filter(value => value.span[0] <= span[0] && value.span[1] >= span[1]) : [];
          if (declarations.length === 1 && mapped.source.mapping?.quality !== 'coarse' && mapped.source.mapping?.quality !== 'synthetic') { candidates.push(declarations[0].ref); exact.push(declarations[0].ref); }
          else if (typeof location.uri === 'string' && location.uri.length) {
            const external = ref(nextId++); candidates.push(external);
            rows.push({ family: 'node', row: { id: external.localId, kind: 'externalDeclaration', span: null, scope: null,
              data: { contextKey: context.contextKey, uri: location.uri, packageName: null, packageVersion: null, nameId: intern(target.name), declarationKind: 'lsp-location', sourceHash: span ? mapped.source.byteHash : null,
                sourceRange: span ? { coordinateUnit: 'utf16', start: span[0], end: span[1] } : null } } });
          }
        }
        const unique = [...new Map(candidates.map(value => [refKey(value), value])).values()];
        const status = unique.length > 1 ? 'ambiguous' : unique.length === 1 && exact.length === 1 ? 'resolved' : unique.length ? 'heuristic' : 'unresolved';
        if (status === 'resolved') completedCount += 1;
        if (response.error) failed = true; if (response.attempted !== true) deferred = true;
        const binding = ref(nextId++); rows.push({ family: 'node', row: { id: binding.localId, kind: 'binding', span: target.span, scope: target.scope,
          data: { occurrence: target.ref, contextKey: context.contextKey, status, signature: null, symbolGroupId: unique.length ? createSymbolGroupId({ contextKey: context.contextKey, declarations: unique }) : null, candidateCount: unique.length } } });
        for (const candidate of unique) {
          const certainty = exact.some(value => refKey(value) === refKey(candidate)) ? 'exact-static' : 'modeled';
          for (const [kind, from] of [['bindingCandidate', binding], [target.roles.includes('construct') ? 'constructTarget' : target.roles.includes('call') ? 'callTarget' : 'references', target.ref]]) rows.push({ family: 'edge', row: { id: edgeId++, kind, from, to: candidate, callSite: null, operandOrdinal: null, contextKey: context.contextKey, condition: null, evidence, certainty } });
        }
      }
      rows.push(...[...names].map(([value,id]) => ({ family: 'lookup', row: { kind: 'name', id, value } })));
      rows.push({ family: 'coverage', row: { scope: { sourceUnitId: item.source.sourceUnitId }, phase: 'bindings', state: !definitionEnabled ? 'unsupported' : item.source.mapping && item.source.mapping.quality !== 'exact' ? 'unsupported' : failed ? 'failed' : deferred ? 'deferred' : !item.policy.targetSelectionConfigured && observations.length && completedCount === observations.length ? 'complete' : definitionEnabled ? 'partial' : 'unsupported',
        reason: item.policy.targetSelectionConfigured ? 'targeted_binding_scope_widened_or_selected_only' : failed ? 'lsp_request_failed' : deferred ? 'lsp_request_admission_or_capability' : completedCount === observations.length && observations.length ? null : 'lsp_candidates_or_unavailable', observedCount: observations.length, completedCount, frontierRef: null } });
      const partition = await writeSemanticAnalysis({ rows, policy, stagingRoot: item.root, source: item.source, sourceBytes: item.bytes, partitionId, producerHash: semanticHash('semantic.lsp-producer.v1', { providerId, providerVersion }), contextHash: context.contextKey, policyHash: semanticHash('semantic.lsp-policy.v1', { enrichment: policy.enrichment || null, evidence: 'definition-location-v1' }), structuralSlots: [], diskAccount: state.semanticDiskAccount, signal });
      emitted.push(partition); contexts.set(context.contextKey, context); completed.add(completionKey);
    },
    output() { return assertSemanticEnvelope('provider', { schemaVersion: 1, contexts: [...contexts.values()], partitions: [...emitted], coverageRef: null, diagnosticsRef: null }); }
  };
  return api;
};
