import { collectCompilerStorageFlow } from './compiler-storage-flow.js';
import { collectCompilerWorkerFlow } from './compiler-worker-flow.js';
import { collectCompilerCrossFileFlow } from './compiler-cross-file-flow.js';
import { collectCompilerFlow } from './compiler-flow.js';
import { collectCompilerValueSlice } from './compiler-value-slice.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createArtifactSemanticStore } from '../../semantic/artifact-store.js';
import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';
import { createAnalysisPartitionId, createSymbolGroupId, semanticHash, canonicalSemanticJson } from './identity.js';
import { createSemanticFactsRef } from './file-ref.js';
import { writeSemanticAnalysis } from './analysis-write.js';
import { resolveSemanticPartPath } from '../../semantic/artifact-store.js';
import { throwIfAborted } from '../../shared/abort.js';

const hashText = text => createHash('sha256').update(text, 'utf8').digest('hex');
const keyPath = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
const spanKey = span => span[0] + ':' + span[1];
const refKey = ref => ref.partitionId + ':' + ref.localId;
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
/** One build-owned session. Inventories hold declarations; full rows live only for the active document. */
export const createSemanticCompilerSession = async ({ state, runtime, signal = null }) => {
  const policy = runtime.semanticPolicy, inventory = new Map(), texts = new Map();
  const emitted = [], contexts = [], declarationChunks = new Map();
  const chunksByUid = new Map((state.chunks || []).map(chunk => [chunk.chunkUid || chunk.metaV2?.chunkUid, chunk]));
  const detailsByFile = new Map();
  for (const chunk of state.chunks || []) {
    if (!detailsByFile.has(chunk.file)) detailsByFile.set(chunk.file, new Map());
    for (const detail of chunk.codeRelations?.callDetails || []) {
      const key = detail.start + ':' + detail.end;
      if (!detailsByFile.get(chunk.file).has(key)) detailsByFile.get(chunk.file).set(key, []);
      detailsByFile.get(chunk.file).get(key).push(detail);
    }
  }
  for (const [file, descriptor] of state.semanticFactsByFile || []) {
    throwIfAborted(signal);
    const root = path.join(runtime.buildRoot, descriptor.storage.relativePath);
    const store = createArtifactSemanticStore({ root, repoRoot: runtime.root, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      generation: descriptor.storage.generation, partitions: descriptor.partitions });
    const syntax = descriptor.partitions.find(p => p.partitionId === descriptor.syntaxPartitionId);
    let source;
    for await (const row of store.iterateRows(syntax.partitionId, 'semantic_sources', { signal })) source = row;
    if (!source || !['javascript', 'typescript'].includes(source.language)) continue;
    let sourceMap = null;
    if (source.mapping) {
      const mapBytes = await fs.readFile(await resolveSemanticPartPath(root, source.mapping.mapRef));
      sourceMap = JSON.parse(mapBytes.toString('utf8'));
      if (createHash('sha256').update(mapBytes).digest('hex') !== path.basename(source.mapping.mapRef, '.json') || semanticHash('semantic.embedded-map.v1', sourceMap) !== source.mapping.identity) throw new Error('Compiler embedded mapping mismatch.');
      const parent = [...state.semanticFactsByFile.values()].find(value => value.sourceUnitId === source.mapping.parentSourceUnitId);
      if (!parent || sourceMap.parentSourceUnitId !== parent.sourceUnitId || sourceMap.parentByteHash !== parent.sourceHash || sourceMap.localEnd !== source.textLength || sourceMap.quality !== source.mapping.quality) throw new Error('Compiler embedded parent mismatch.');
      if (source.mapping.quality !== 'exact') continue;
    }
    await store.verifySource(source, { signal });
    const bytes = await fs.readFile(path.join(root, 'semantic-sources', source.byteHash + '.utf8'));
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (hashText(text) !== source.textHash) throw new Error('Compiler source snapshot mismatch.');
    const declarations = new Map();
    for await (const row of store.iterateRows(syntax.partitionId, 'semantic_records', { signal })) {
      if (row.kind === 'declaration' && row.span) declarations.set(spanKey(row.span), { partitionId: syntax.partitionId, localId: row.id });
    }
    const declarationIds = new Set([...declarations.values()].map(ref => ref.localId));
    for (const partition of descriptor.partitions) for await (const join of store.iterateRows(partition.partitionId, 'semantic_ownership', { signal })) {
      if (join.role === 'primary' && join.recordRef.partitionId === syntax.partitionId && declarationIds.has(join.recordRef.localId)) {
        declarationChunks.set(refKey(join.recordRef), join.chunkUid);
      }
    }
    inventory.set(keyPath(path.join(runtime.root, source.path)), { file, descriptor, source, root, store, syntax, declarations, sourceMap });
    texts.set(source.path, text);
  }
  const sourceForDoc = doc => {
    if (doc.semanticSourceUnitId && !doc.segmentUid) return [...inventory.values()].find(item => !item.source.mapping && item.source.sourceUnitId === doc.semanticSourceUnitId);
    const container = keyPath(path.resolve(runtime.root, doc.containerPath || doc.virtualPath));
    if (doc.segmentUid) return [...inventory.values()].find(item => item.sourceMap?.segmentUid === doc.segmentUid && item.sourceMap.parentStart === doc.segmentRange?.start && item.sourceMap.parentEnd === doc.segmentRange?.end && item.sourceMap.localEnd === doc.text.length && texts.get(item.source.path) === doc.text && [...state.semanticFactsByFile].some(([parentFile, parent]) => parent.sourceUnitId === item.source.mapping.parentSourceUnitId && keyPath(path.join(runtime.root, parentFile)) === container));
    return inventory.get(container);
  };
  return {
    fileTextByFile: texts,
    prepareDocuments(documents) {
      const result = documents.map(doc => { const item = sourceForDoc(doc); return item ? { ...doc, semanticSourceUnitId: item.source.sourceUnitId } : doc; });
      const present = new Set(result.filter(doc => !doc.segmentUid).map(doc => keyPath(path.resolve(runtime.root, doc.containerPath || doc.virtualPath))));
      for (const [file, item] of inventory) if (!item.source.mapping && !present.has(file)) {
        result.push({ virtualPath: item.source.path, containerPath: item.source.path,
          languageId: item.source.language, effectiveExt: path.extname(item.source.path),
          text: texts.get(item.source.path), docHash: item.source.textHash, lineIndex: item.source.lineStarts,
          segmentUid: null, segmentRange: { start: 0, end: item.source.textLength } });
      }
      return result;
    },
    get enabled() { return inventory.size > 0; },
    beginGroup({ ts, program, options, documents, configPath }) {
      // The complete sorted Program inventory is the initial conservative dependency key.
      const sources = program.getSourceFiles().map(sf => ({ path: sf.fileName.split(path.sep).join('/'), hash: hashText(sf.text) }))
        .sort((a, b) => order(a.path, b.path));
      const configHash = semanticHash('semantic.compiler-config.v1', { options: JSON.parse(JSON.stringify(options)), configPath: configPath || null });
      const moduleResolutionHash = semanticHash('semantic.compiler-dependencies.v1', sources);
      const vfsMappingHash = semanticHash('semantic.compiler-vfs.v1', documents.map(doc => ({
        virtualPath: doc.virtualPath, sourceUnitId: sourceForDoc(doc)?.source.sourceUnitId || null
      })).sort((a, b) => order(a.virtualPath, b.virtualPath)));
      const contextKey = semanticHash('semantic.compiler-context.v1', { configHash, moduleResolutionHash, vfsMappingHash, compilerVersion: ts.version });
      const mappedFiles = new Map(), mappedDocuments = new Map();
      for (const doc of documents) {
        const item = sourceForDoc(doc);
        if (item && doc.text === texts.get(item.source.path)) { const key = keyPath(path.resolve(runtime.root, doc.virtualPath)); mappedFiles.set(key, item); mappedDocuments.set(key, doc); }
      }
      const context = { contextKey, sourceUnits: [...new Map([...mappedFiles.values()].map(item => [item.source.sourceUnitId,
        { sourceUnitId: item.source.sourceUnitId, byteHash: item.source.byteHash }])).values()].sort((a, b) => order(a.sourceUnitId, b.sourceUnitId)),
      providerId: 'typescript', providerVersion: '2.1.0', compilerVersion: ts.version, configHash, moduleResolutionHash, vfsMappingHash };
      contexts.push(context);
      state.semanticCompilerContexts = contexts;
      return { context, mappedFiles, mappedDocuments, repoRoot: runtime.root, workerDocuments: [], flowDocuments: [], dependencyHashes: sources.map(row => row.hash), isDefaultLibrary: sf => program.isSourceFileDefaultLibrary(sf), sourceHashes: new Map(sources.map(row => [keyPath(row.path), row.hash])) };
    },
    async collectDocument({ ts, checker, sourceFile, nodeIndex, group }) {
      const item = group.mappedFiles.get(keyPath(sourceFile.fileName));
      if (!item) return;
      if (hashText(sourceFile.text) !== item.source.textHash) throw Object.assign(new Error('Compiler/source join rejected.'), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
      const { context } = group;
      const partitionId = createAnalysisPartitionId({ pass: { name: 'typescript-bindings', version: '1' },
        inputPartitionHashes: [item.syntax.canonicalHash], compilerContext: context,
        dependencySummaryHashes: group.dependencyHashes, analysisPolicy: { bindings: 'checker', version: 1 } });
      const ref = localId => ({ partitionId, localId });
      const external = new Map(), observations = [], aliases = new Map(), expressions = new Map();
      const declarationRef = declaration => {
        const sf = declaration.getSourceFile(), name = declaration.name;
        const anchor = name && (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name)) ? name : declaration;
        const start = anchor.getStart(sf), end = anchor.getEnd();
        const target = group.mappedFiles.get(keyPath(sf.fileName)) || inventory.get(keyPath(sf.fileName));
        if (target) {
          if (hashTextCached(sf) !== target.source.textHash) return null;
          return target.declarations.get(start + ':' + end) || null;
        }
        // Unindexed repository sources are frontiers, not external library declarations.
        const relative = path.relative(runtime.root, sf.fileName);
        if (!relative.startsWith('..') && !path.isAbsolute(relative) && !relative.split(path.sep).includes('node_modules')) return null;
        const uri = pathToFileURL(sf.fileName).href, sourceHash = hashTextCached(sf);
        const key = canonicalSemanticJson({ uri, sourceHash, start, end, kind: ts.SyntaxKind[declaration.kind] });
        if (!external.has(key)) external.set(key, { uri, sourceHash, start, end,
          name: name?.text || '<anonymous>', declarationKind: ts.SyntaxKind[declaration.kind] });
        return { externalKey: key };
      };
      const hashTextCached = sf => {
        const key = keyPath(sf.fileName);
        if (!group.sourceHashes.has(key)) group.sourceHashes.set(key, hashText(sf.text));
        return group.sourceHashes.get(key);
      };
      const symbolTargets = symbol => (symbol?.declarations || []).map(declarationRef).filter(Boolean);
      for await (const row of item.store.iterateRows(item.syntax.partitionId, 'semantic_records', { signal })) {
        if (row.kind === 'expression' && row.span) expressions.set(spanKey(row.span), { partitionId: item.syntax.partitionId, localId: row.id });
        if (!row.span || (row.kind !== 'occurrence' && !(row.kind === 'expression' && row.data.invocationKind))) continue;
        throwIfAborted(signal);
        const nodes = nodeIndex.exact(row.span[0], row.span[1]);
        const invocation = row.kind === 'expression';
        const node = nodes.find(n => invocation ? ts.isCallExpression(n) || ts.isNewExpression(n) || ts.isTaggedTemplateExpression(n)
          : ts.isIdentifier(n) || ts.isPrivateIdentifier(n));
        const occurrence = { partitionId: item.syntax.partitionId, localId: row.id };
        let symbol = node ? checker.getSymbolAtLocation(invocation ? node.expression || node.tag : node) : null;
        let targets = symbolTargets(symbol), aliasTargets = [];
        if (symbol && (symbol.flags & ts.SymbolFlags.Alias)) {
          const seen = new Set();
          while (symbol && (symbol.flags & ts.SymbolFlags.Alias) && !seen.has(symbol)) {
            seen.add(symbol);
            const next = typeof checker.getImmediateAliasedSymbol === 'function'
              ? checker.getImmediateAliasedSymbol(symbol) || checker.getAliasedSymbol(symbol) : checker.getAliasedSymbol(symbol);
            if (!next || next === symbol) { targets = []; break; }
            const nextTargets = symbolTargets(next);
            for (const from of targets) for (const to of nextTargets) {
              const key = canonicalSemanticJson({ from, to }); aliases.set(key, { from, to });
            }
            aliasTargets.push(...targets); targets = nextTargets; symbol = next;
          }
        }
        let signature = null;
        if (node && invocation) {
          signature = checker.getResolvedSignature(node);
          if (signature?.declaration && !targets.length) targets = [declarationRef(signature.declaration)].filter(Boolean);
        }
        const unique = [...new Map(targets.map(target => [canonicalSemanticJson(target), target])).values()];
        observations.push({ node, occurrence, span: row.span, scope: row.scope, targets: unique, invocation,
          invocationKind: row.data.invocationKind || null, unresolved: !node || !unique.length,
          aliasTargets, signatureDeclaration: signature?.declaration || null,
          parameterTargets: (signature?.declaration?.parameters || []).map(parameter => parameter.dotDotDotToken ? null : declarationRef(parameter)) });
      }
      const rows = [], externalRefs = new Map(), names = new Map();
      const intern = name => { if (!names.has(name)) names.set(name, names.size); return names.get(name); };
      let nextId = 0;
      const evidence = ref(nextId++);
      rows.push({ family: 'node', row: { id: evidence.localId, kind: 'evidence', span: null, scope: null,
        data: { method: 'typescript-checker', producerId: 'typescript', producerVersion: ts.version,
          evidenceKind: 'compiler-resolved', sourceRef: item.source.sourceUnitId, artifactRef: null } } });
      for (const [key, target] of [...external].sort(([a], [b]) => order(a, b))) {
        externalRefs.set(key, ref(nextId));
        rows.push({ family: 'node', row: { id: nextId++, kind: 'externalDeclaration', span: null, scope: null,
          data: { contextKey: context.contextKey, uri: target.uri, packageName: null, packageVersion: null,
            nameId: intern(target.name), declarationKind: target.declarationKind, sourceHash: target.sourceHash,
            sourceRange: { coordinateUnit: 'utf16', start: target.start, end: target.end } } } });
      }
      const expand = target => target.externalKey ? externalRefs.get(target.externalKey) : target;
      const edges = [];
      const edge = (kind, from, to, callSite = null, operandOrdinal = null) => edges.push({ kind, from, to, callSite, operandOrdinal,
        contextKey: context.contextKey, condition: null, evidence, certainty: 'exact-static' });
      let completedCount = 0;
      for (const observation of observations.sort((a, b) => a.occurrence.localId - b.occurrence.localId)) {
        const targets = observation.targets.map(expand);
        if (targets.length) completedCount += 1;
        const binding = ref(nextId);
        observation.bindingRef = binding;
        if (observation.invocation) {
          const candidates = targets.map(target => {
            const chunkUid = declarationChunks.get(refKey(target)), chunk = chunksByUid.get(chunkUid);
            if (!chunk) return null;
            const symbol = chunk.metaV2?.symbol || {};
            return { chunkUid, symbolId: symbol.symbolId || null, symbolKey: symbol.symbolKey || null,
              signatureKey: symbol.signatureKey || null, kindGroup: symbol.kindGroup || null };
          }).filter(Boolean);
          for (const detail of detailsByFile.get(item.source.path)?.get(spanKey(observation.span)) || []) {
            const status = targets.length === 1 && candidates.length === 1 ? 'resolved' : targets.length > 1 ? 'ambiguous' : 'unresolved';
            detail.semanticRecordRef = observation.occurrence;
            detail.compilerBinding = { ref: binding, contextKey: context.contextKey,
              symbolRef: { v: 1, targetName: detail.callee, kindHint: null, importHint: null, candidates,
                status, resolved: status === 'resolved' ? { symbolId: candidates[0].symbolId, chunkUid: candidates[0].chunkUid } : null } };
          }
        }
        rows.push({ family: 'node', row: { id: nextId++, kind: 'binding', span: observation.span, scope: observation.scope,
          data: { occurrence: observation.occurrence, contextKey: context.contextKey,
            status: targets.length > 1 ? 'ambiguous' : targets.length === 1 ? 'resolved' : 'unresolved',
            signature: null, symbolGroupId: targets.length ? createSymbolGroupId({ contextKey: context.contextKey, declarations: targets }) : null,
            candidateCount: targets.length } } });
        if (observation.invocation && observation.signatureDeclaration) {
          const args = observation.node.arguments || [];
          for (let ordinal = 0; ordinal < args.length; ordinal += 1) {
            if (ts.isSpreadElement(args[ordinal])) break;
            const parameterTarget = observation.parameterTargets[ordinal];
            const argument = expressions.get(args[ordinal].getStart(sourceFile) + ':' + args[ordinal].end);
            if (parameterTarget && argument) edge('argumentToParameter', argument, expand(parameterTarget), observation.occurrence, ordinal);
          }
        }
        for (const target of targets) {
          edge('bindingCandidate', binding, target);
          edge(observation.invocation ? observation.invocationKind === 'construct' ? 'constructTarget' : 'callTarget' : 'references',
            observation.occurrence, target, observation.invocation ? observation.occurrence : null);
        }
      }
      for (const { from, to } of aliases.values()) edge('aliases', expand(from), expand(to));
      const uniqueEdges = [...new Map(edges.map(row => [canonicalSemanticJson(row), row])).entries()].sort(([a], [b]) => order(a, b));
      for (let id = 0; id < uniqueEdges.length; id += 1) rows.push({ family: 'edge', row: { id, ...uniqueEdges[id][1] } });
      for (const [value, id] of names) rows.push({ family: 'lookup', row: { kind: 'name', id, value } });
      const coverage = { scope: { sourceUnitId: item.source.sourceUnitId }, phase: 'bindings',
        state: completedCount === observations.length ? 'complete' : 'partial',
        reason: completedCount === observations.length ? null : 'unresolved_or_unmapped_checker_occurrence',
        observedCount: observations.length, completedCount, frontierRef: null };
      rows.push({ family: 'coverage', row: coverage });
      const bytes = await fs.readFile(path.join(item.root, 'semantic-sources', item.source.byteHash + '.utf8'));
      const partition = await writeSemanticAnalysis({ rows, policy, stagingRoot: item.root, source: item.source,
        sourceBytes: bytes, partitionId, producerHash: semanticHash('semantic.compiler-producer.v1', { version: '1', compiler: ts.version }),
        contextHash: context.contextKey, policyHash: semanticHash('semantic.binding-policy.v1', { version: 1 }),
        diskAccount: state.semanticDiskAccount, signal });
      for (const observation of observations) if (observation.invocation) {
        for (const detail of detailsByFile.get(item.source.path)?.get(spanKey(observation.span)) || []) detail.semanticFactsHash = partition.canonicalHash;
      }
      emitted.push(partition);
      const valueSlice = await collectCompilerValueSlice({ ts, checker, sourceFile, nodes: nodeIndex.nodes(),
        expressionFor: node => node ? expressions.get(node.getStart(sourceFile) + ':' + node.end) || null : null,
        observations, source: item.source, bytes, bindingPartition: partition, context,
        isDefaultLibrary: group.isDefaultLibrary, root: item.root, policy, diskAccount: state.semanticDiskAccount, signal });
      if (valueSlice) emitted.push(valueSlice.partition);
      const storageFlow = await collectCompilerStorageFlow({ ts, checker, sourceFile, nodes: nodeIndex.nodes(),
        expressionFor: node => node ? expressions.get(node.getStart(sourceFile) + ':' + node.end) || null : null,
        observations, source: item.source, bytes, bindingPartition: partition, context,
        isDefaultLibrary: group.isDefaultLibrary, root: item.root, policy, diskAccount: state.semanticDiskAccount, signal });
      if (storageFlow) emitted.push(storageFlow.partition);
      const flow = await collectCompilerFlow({ ts, checker, sourceFile, nodes: nodeIndex.nodes(),
        expressionFor: node => node ? expressions.get(node.getStart(sourceFile) + ':' + node.end) || null : null,
        declarationFor: declaration => {
          const node = declaration?.name || declaration;
          return node ? item.declarations.get(node.getStart(sourceFile) + ':' + node.end) || null : null;
        }, source: item.source, bytes, bindingPartition: partition, context,
        root: item.root, policy, diskAccount: state.semanticDiskAccount, signal });
      if (flow) {
        emitted.push(flow.partition);
        group.flowDocuments.push({ item, bytes, partition: flow.partition,
          summaries: flow.summaries.map(summary => ({ ...summary, owner: undefined,
            async: Boolean(summary.owner.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)), generator: Boolean(summary.owner.asteriskToken) })),
          calls: observations.filter(observation => observation.invocation).map(observation => ({ occurrence: observation.occurrence,
            targets: observation.targets.map(expand), invocationKind: observation.invocationKind })) });
      }

      group.workerDocuments.push({ ts, checker, item, bytes, sourceFile, nodes: nodeIndex.nodes(), observations, bindingPartition: partition,
        containerPath: group.mappedDocuments.get(keyPath(sourceFile.fileName))?.containerPath,
        expressionFor: node => node ? expressions.get(node.getStart(sourceFile) + ':' + node.end) || null : null });
      const current = state.semanticFactsByFile.get(item.file);
      state.semanticFactsByFile.set(item.file, createSemanticFactsRef({ source: item.source,
        syntaxPartitionId: current.syntaxPartitionId, storage: current.storage,
        partitions: [...current.partitions.filter(p => p.partitionId !== partition.partitionId && p.partitionId !== valueSlice?.partition.partitionId && p.partitionId !== flow?.partition.partitionId && p.partitionId !== storageFlow?.partition.partitionId), partition, ...(valueSlice ? [valueSlice.partition] : []), ...(flow ? [flow.partition] : []), ...(storageFlow ? [storageFlow.partition] : [])],
        coverage: [...current.coverage.filter(c => c.phase !== 'bindings' && (!valueSlice || !['localFlow', 'boundaryModels'].includes(c.phase))), coverage, ...(valueSlice?.coverage || []), ...(flow?.coverage || []), ...(storageFlow?.coverage || [])] }));
    },
    async finishGroup(group) { emitted.push(...await collectCompilerCrossFileFlow({ group, state, policy, signal })); emitted.push(...await collectCompilerWorkerFlow({ group, state, policy, signal })); group.workerDocuments = []; },
    output() { return { schemaVersion: 1, contexts, partitions: emitted, coverageRef: null, diagnosticsRef: null }; }
  };
};
