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
import { getLspLineIndex } from '../../integrations/tooling/lsp/positions.js';
import { throwIfAborted } from '../../shared/abort.js';
import { nativeExecutionAuthority } from './native-execution-context.js';
import { readVerifiedContainedFile } from '../../shared/contained-file.js';
import { createLspSourceIndex } from './lsp-source-index.js';
import { createLspObservationCollector } from '../../integrations/tooling/providers/lsp/structured-observations.js';
import { writeStructuredLspEvidence } from './lsp-structured-evidence.js';
const refKey = ref => canonicalSemanticJson(ref);
/** One build-owned LSP lane; this owns no server, Program, or request scheduler. */
export const createSemanticLspSession = async ({ state, runtime, signal = null, languages = null, eagerOnly = false }) => {
  const inventory = new Map(), byUri = new Map(), texts = new Map(), emitted = [], contexts = new Map(), completed = new Set();
  const policy = runtime.semanticPolicy;
  const nativeAuthority = nativeExecutionAuthority(state);
  const sourcePaths = new Map();
  for (const [file, facts] of state.semanticFactsByFile || []) if (!sourcePaths.has(facts.sourceUnitId)) sourcePaths.set(facts.sourceUnitId, file);
  state.semanticEvidenceArtifacts ||= [];
  for (const [file, facts] of state.semanticFactsByFile || []) {
    throwIfAborted(signal);
    const root = path.join(runtime.buildRoot, facts.storage.relativePath);
    const store = createArtifactSemanticStore({ root, repoRoot: runtime.root, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation: facts.storage.generation, partitions: facts.partitions });
    const syntax = facts.partitions.find(partition => partition.partitionId === facts.syntaxPartitionId);
    let source;
    for await (const row of store.iterateRows(syntax.partitionId, 'semantic_sources', { signal })) source = row;
    if (!source || languages && !languages.includes(source.language)) continue;
    if (nativeAuthority && !nativeAuthority.sourceUnits.has(source.sourceUnitId)) continue;
    await store.verifySource(source, { signal });
    if (source.encoding === 'binary') continue;
    const bytes = await fs.readFile(path.join(root, 'semantic-sources', source.byteHash + '.utf8'));
    const occurrenceIds = new Set(), expressionKinds=new Map(), parents=new Map();
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), declarations = [];
    for await (const row of store.iterateRows(syntax.partitionId, 'semantic_records', { signal })) { if(row.kind==='expression')expressionKinds.set(row.id,row.data); if (row.kind === 'declaration' && row.span) declarations.push({ span: row.span, ref: { partitionId: syntax.partitionId, localId: row.id } }); if (row.kind === 'occurrence' && row.span && !row.data.roles.includes('definition')) occurrenceIds.add(refKey({ partitionId: syntax.partitionId, localId: row.id })); }
    for await(const row of store.iterateRows(syntax.partitionId,'semantic_operands',{signal}))if(row.child?.partitionId===syntax.partitionId&&row.parent.partitionId===syntax.partitionId)parents.set(row.child.localId,{parent:row.parent,slot:row.slot});
    const invocationFor = expression => {
      const seen=new Set();let current=expression;
      while(current?.partitionId===syntax.partitionId&&seen.size<8&&!seen.has(current.localId)) {
        seen.add(current.localId);const link=parents.get(current.localId);if(!link)return null;
        const data=expressionKinds.get(link.parent.localId);
        if(data?.invocationKind)return ['callee','tag','expression'].includes(link.slot)?{ref:link.parent,kind:data.invocationKind}:null;
        const member=['PropertyAccessExpression','ElementAccessExpression','MemberExpression','OptionalMemberExpression'].includes(data?.astKind);
        // The receiver occurrence in obj.method() is not the invoked member.
        if(member?!['name','property','ast:PropertyAccessExpression.name'].includes(link.slot):!['ParenthesizedExpression','NonNullExpression'].includes(data?.astKind)||!['expression','ast:ParenthesizedExpression.expression','ast:NonNullExpression.expression'].includes(link.slot))return null;
        current=link.parent;
      }
      return null;
    };
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
    const sourcePath = source.mapping ? sourcePaths.get(source.mapping.parentSourceUnitId) || source.path : source.path;
    const sourcePolicy = resolveSemanticSourcePolicy(policy, { sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash, language: source.language, path: sourcePath });
    const plan = state.semanticPlanningBySource?.get(source.sourceUnitId) || planSemanticSource(sourcePolicy, { sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash, syntaxPartitionId: syntax.partitionId });
    const item = { sourceMap, policy: sourcePolicy, plan, invocationFor, unresolvedCount, file, facts, root, store, syntax, source, text, bytes, declarations, resolved };
    inventory.set(source.sourceUnitId, item);
    if (!source.mapping) { texts.set(source.path, text); byUri.set(pathToFileURL(path.join(runtime.root, source.path)).href, item); }
  }
  const sourceIndex = createLspSourceIndex({ inventory, repoRoot: runtime.root });
  const itemForDoc = sourceIndex.itemForDocument;
  const contextFor = ({ item, uri, providerId, providerVersion, workspaceKey, positionEncoding }) => {
    const context = { providerId, providerVersion, compilerVersion: null,
      configHash: semanticHash('semantic.lsp-config.v1', { providerId, providerVersion, workspaceKey, positionEncoding,
        ...(nativeAuthority ? { nativeAuthorityHash: nativeAuthority.authorityHash } : {}) }),
      moduleResolutionHash: sourceIndex.digest,
      vfsMappingHash: semanticHash('semantic.lsp-mapping.v1', { uri, mapping: item.source.mapping }) };
    context.contextKey = semanticHash('semantic.lsp-context.v1', context);
    context.sourceUnits = [{ sourceUnitId: item.source.sourceUnitId, byteHash: item.source.byteHash }];
    return context;
  };
  const api = {
    get enabled() { return inventory.size > 0; }, get hasTargetedWork() { return [...inventory.values()].some(item => item.unresolvedCount > 0); }, fileTextByFile: texts,
    setSignal(value) { signal = value; },
    async nativeDocumentUri(doc) {
      if (!nativeAuthority) return null;
      const item = itemForDoc(doc);
      if (!item || item.source.mapping || item.source.language !== 'c' || doc.text !== item.text
        || !nativeAuthority.sourceUnits.has(item.source.sourceUnitId) || nativeExecutionAuthority(state) !== nativeAuthority) {
        throw Object.assign(new Error('Native document differs from its admitted source authority.'), { code: 'ERR_SEMANTIC_NATIVE_UNSEALED' });
      }
      const filename = path.resolve(runtime.root, item.source.path);
      await readVerifiedContainedFile(runtime.root, filename, { maxBytes: 1024 * 1024, expectedHash: item.source.byteHash, signal });
      if (nativeExecutionAuthority(state) !== nativeAuthority) throw Object.assign(new Error('Native document grant expired.'), { code: 'ERR_SEMANTIC_NATIVE_UNSEALED' });
      return pathToFileURL(filename).href;
    },
    prepareDocuments(documents) {
      const result = documents.map(doc => { const item = itemForDoc(doc); return item ? { ...doc,lineIndex:getLspLineIndex(item.text,item.source),lineIndexKind:'lsp', languageId: item.source.language, semanticSourceUnitId: item.source.sourceUnitId } : doc; }), present = new Set(result.map(doc => itemForDoc(doc)?.source.sourceUnitId));
      for (const item of inventory.values()) if (!item.source.mapping && !present.has(item.source.sourceUnitId)) result.push({ virtualPath: item.source.path, containerPath: item.source.path, languageId: item.source.language, effectiveExt: path.extname(item.source.path), text: item.text, docHash: item.source.textHash, lineIndex: getLspLineIndex(item.text,item.source), segmentUid: null, segmentRange: { start: 0, end: item.source.textLength }, semanticSourceUnitId: item.source.sourceUnitId });
      return result;
    },
    registerDocument(doc, uri) {
      const item = itemForDoc(doc);
      if (!item) return;
      if (doc.text !== item.text) throw Object.assign(new Error('LSP document differs from immutable semantic source.'), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
      byUri.set(uri, item);
    },
    createObservationCollector({ doc, uri, providerId = 'lsp', providerVersion = '1', workspaceKey = null, positionEncoding = 'utf-16' }) {
      const item = itemForDoc(doc);
      if (!item) return null;
      if (item.policy.targetSelectionConfigured || eagerOnly && item.policy.enrichment.bindings !== 'eager'
        || state.semanticAdmittedSources && !state.semanticAdmittedSources.has(item.source.sourceUnitId)
        || !semanticPhasePolicy(item.policy, item.plan, 'bindings', runtime, item.source.sourceUnitId).admitted
          && !state.semanticAdmittedSources?.has(item.source.sourceUnitId)) return null;
      api.registerDocument(doc, uri);
      const context = contextFor({ item, uri, providerId, providerVersion, workspaceKey, positionEncoding });
      const collector = createLspObservationCollector({ identity: { sessionId: context.contextKey,
        profileId: 'context:' + context.contextKey, profileQualification: 'unknown', generation: item.facts.storage.generation,
        sourceUnitId: item.source.sourceUnitId, sourceHash: item.source.byteHash, contextHash: context.contextKey, uri },
      consumers: ['navigation', 'symbolDetail'], signal, maxMs: 30000,
      isCurrent: () => doc.text === item.text && state.semanticFactsByFile.get(item.file)?.sourceHash === item.source.byteHash,
      sourceForUri: targetUri => {
        if (byUri.has(targetUri)) return byUri.get(targetUri);
        try { return targetUri?.startsWith('file:') ? sourceIndex.itemForPath(fileURLToPath(targetUri)) : null; } catch { return null; }
      } });
      return { record: collector.record, async flush() {
        throwIfAborted(signal);
        collector.assertCurrent();
        const observations = collector.observations();
        if (!observations.length) return;
        const partition = await writeStructuredLspEvidence({ observations, item, context, state, signal,
          declarationsForFact: fact => {
            const target = inventory.get(fact.target.sourceUnitId);
            return target ? sourceIndex.containingDeclarations(target, fact.target.span) : [];
          } });
        collector.assertCurrent();
        if (partition && !emitted.some(value => value.partitionId === partition.partitionId)) emitted.push(partition);
        contexts.set(context.contextKey, context);
        collector.invalidate();
      } };
    },
    async targetsForDocument(doc) {
      const item = itemForDoc(doc); if (!item) return [];
      if (eagerOnly && item.policy.enrichment.bindings !== 'eager') return [];
      if (state.semanticAdmittedSources && !state.semanticAdmittedSources.has(item.source.sourceUnitId)) return [];
      if (!semanticPhasePolicy(item.policy, item.plan, 'bindings', runtime, item.source.sourceUnitId).admitted && !state.semanticAdmittedSources?.has(item.source.sourceUnitId)) return [];
      if (doc.text !== item.text) throw Object.assign(new Error('LSP source snapshot mismatch.'), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
      const current = state.semanticFactsByFile.get(item.file);
      if (current && current.canonicalHash !== item.facts.canonicalHash) {
        const refreshed = createArtifactSemanticStore({ root: item.root, repoRoot: runtime.root, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation: current.storage.generation, partitions: current.partitions });
        item.resolved.clear();
        for (const partition of current.partitions) if (partition.partitionId !== item.syntax.partitionId) for await (const row of refreshed.iterateRows(partition.partitionId, 'semantic_records', { signal })) if (row.kind === 'binding' && row.data.status === 'resolved') item.resolved.add(refKey(row.data.occurrence));
        item.facts = current;
      }
      const targets = [], selectedScopes = await collectSemanticTargetScopes({ policy: item.policy, store: item.store, partitionId: item.syntax.partitionId, signal });
      for await (const row of item.store.iterateRows(item.syntax.partitionId, 'semantic_records', { signal })) {
        if (row.kind !== 'occurrence' || !row.span || row.data.roles.includes('definition')) continue;
        if (!semanticTargetMatchesRecord(item.policy, item.syntax.partitionId, row, selectedScopes)) continue;
        const ref = { partitionId: item.syntax.partitionId, localId: row.id };
        const invocation=item.invocationFor(row.data.expression);
        if (!item.resolved.has(refKey(ref)) && (!invocation || !item.resolved.has(refKey(invocation.ref)))) {
          targets.push({ ref, invocation, span: row.span, scope: row.scope, roles: row.data.roles, name: item.text.slice(...row.span) });
        }
      }
      return targets;
    },
    async collectDocument({ doc, uri, requestDefinition, positionEncoding = 'utf-16', providerId = 'lsp', providerVersion = '1', workspaceKey = null, definitionEnabled = true, targets = null }) {
      const item = itemForDoc(doc); if (!item) return;
      const policy = item.policy;
      if (eagerOnly && policy.enrichment.bindings !== 'eager') return;
      if (state.semanticAdmittedSources && !state.semanticAdmittedSources.has(item.source.sourceUnitId)) return;
      if (!semanticPhasePolicy(policy, item.plan, 'bindings', runtime, item.source.sourceUnitId).admitted && !state.semanticAdmittedSources?.has(item.source.sourceUnitId)) return;
      api.registerDocument(doc, uri);
      const context = contextFor({ item, uri, providerId, providerVersion, workspaceKey, positionEncoding });
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
          if (!mapped && location.uri?.startsWith('file:')) { try { mapped = sourceIndex.itemForPath(fileURLToPath(location.uri)); } catch { /* Not a recognized source URI. */ } }
          const span = mapped ? exactLspRange(mapped.source, mapped.text, location.range, positionEncoding) : null;
          const originSpan = location.originRange ? exactLspRange(item.source, item.text, location.originRange, positionEncoding) : target.span;
          const origin = originSpan && originSpan[0] <= target.span[0] && originSpan[1] >= target.span[1];
          const declarations = span && origin ? sourceIndex.containingDeclarations(mapped, span) : [];
          if (declarations.length === 1 && mapped.source.mapping?.quality !== 'coarse' && mapped.source.mapping?.quality !== 'synthetic') { candidates.push(declarations[0].ref); exact.push(declarations[0].ref); }
          else if (typeof location.uri === 'string' && location.uri.length) {
            const external = ref(nextId++); candidates.push(external);
            rows.push({ family: 'node', row: { id: external.localId, kind: 'externalDeclaration', span: null, scope: null,
              data: { contextKey: context.contextKey, uri: location.uri, packageName: null, packageVersion: null, nameId: intern(target.name), declarationKind: 'lsp-location', sourceHash: span ? mapped.source.byteHash : null,
                sourceRange: span ? { coordinateUnit: 'utf16', start: span[0], end: span[1] } : null } } });
          }
        }
        const unique = [...new Map(candidates.map(value => [refKey(value), value])).values()];
        const status = unique.length > 1 ? 'ambiguous' : unique.length === 1 && exact.length > 0 ? 'resolved' : unique.length ? 'heuristic' : 'unresolved';
        if (status === 'resolved') completedCount += 1;
        if (response.error) failed = true; if (response.attempted !== true) deferred = true;
        const binding = ref(nextId++); rows.push({ family: 'node', row: { id: binding.localId, kind: 'binding', span: target.span, scope: target.scope,
          data: { occurrence: target.ref, contextKey: context.contextKey, status, signature: null, symbolGroupId: unique.length ? createSymbolGroupId({ contextKey: context.contextKey, declarations: unique }) : null, candidateCount: unique.length } } });
        for (const candidate of unique) {
          const certainty = exact.some(value => refKey(value) === refKey(candidate)) ? 'exact-static' : 'modeled';
          for (const [kind, from] of [['bindingCandidate', binding], [target.invocation?.kind==='construct' || target.roles.includes('construct') ? 'constructTarget' : target.invocation || target.roles.includes('call') ? 'callTarget' : 'references', target.invocation?.ref||target.ref]]) rows.push({ family: 'edge', row: { id: edgeId++, kind, from, to: candidate, callSite: ['callTarget','constructTarget'].includes(kind)?target.invocation?.ref||null:null, operandOrdinal: null, contextKey: context.contextKey, condition: null, evidence, certainty } });
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
