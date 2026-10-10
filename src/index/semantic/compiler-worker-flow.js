import path from 'node:path';
import { createAnalysisPartitionId, semanticHash, canonicalSemanticJson } from './identity.js';
import { createSemanticFactsRef } from './file-ref.js';
import { writeSemanticAnalysis } from './analysis-write.js';
import { throwIfAborted } from '../../shared/abort.js';
const keyPath = file => { const value = path.resolve(file); return process.platform === 'win32' ? value.toLowerCase() : value; };
const library = node => node?.getSourceFile().fileName.replaceAll('\\', '/').split('/').pop();
const ownerName = node => { let parent = node; while (parent && !parent.name && parent.parent) parent = parent.parent; return parent?.name?.text || ''; };
/** Source-resolved dispatch candidates. These edges never attest thread execution or delivery. */
export const collectCompilerWorkerFlow = async ({ group, state, policy, signal = null }) => {
  const argumentsPolicy = policy;
  const documents = [...(group.workerDocuments || [])].sort((a,b) => a.item.source.sourceUnitId.localeCompare(b.item.source.sourceUnitId)), output = [], hashes = documents.map(doc => doc.bindingPartition.canonicalHash).sort();
  const entries = new Map(), ledgers = new Map();
  for (const doc of documents) {
    const policy = doc.policy || argumentsPolicy;
    const container = doc.containerPath || (!doc.item.source.mapping ? doc.item.source.path : null);
    if (container && (!doc.item.source.mapping || doc.item.source.mapping.quality === 'exact')) {
      const key = keyPath(path.resolve(group.repoRoot, container)); if (!entries.has(key)) entries.set(key, []); entries.get(key).push(doc);
    }
    const partitionId = createAnalysisPartitionId({ pass: { name: 'compiler-worker-source-flow', version: '2' }, inputPartitionHashes: hashes,
      compilerContext: { context: group.context.contextKey, source: doc.item.source.sourceUnitId }, dependencySummaryHashes: group.dependencyHashes,
      analysisPolicy: { mode: policy.enrichment.crossFileFlow, fieldPathDepth: policy.enrichment.fieldPathDepth } });
    const evidence = { partitionId, localId: 0 }, rows = [{ family: 'node', row: { id: 0, kind: 'evidence', span: null, scope: null,
      data: { method: 'compiler-platform-worker-source-model', producerId: 'semantic-worker-flow', producerVersion: '2', evidenceKind: 'modeled', sourceRef: doc.item.source.sourceUnitId, artifactRef: null } } }];
    ledgers.set(doc, { partitionId, evidence, rows, edges: [], reasons: new Set(), nextId: 1, observed: 0, completed: 0 });
  }
  const authority = (doc, declaration, names, libraries = ['lib.dom.d.ts','lib.webworker.d.ts']) => declaration && group.isDefaultLibrary(declaration.getSourceFile()) && libraries.includes(library(declaration)) && names.includes(ownerName(declaration));
  const platformType = (doc, node, names, libraries = null) => {
    const type = doc.checker.getTypeAtLocation(node), alternatives = type.isUnion() ? type.types : [type];
    return alternatives.length > 0 && alternatives.every(value => names.includes(value.symbol?.name) && value.symbol.declarations?.some(declaration => group.isDefaultLibrary(declaration.getSourceFile()) && (!libraries || libraries.includes(library(declaration)))));
  };
  const boundary = (doc, node, kind, invocation, toContext = null, fromContext = null) => {
    const ledger = ledgers.get(doc), ref = { partitionId: ledger.partitionId, localId: ledger.nextId++ };
    ledger.rows.push({ family: 'node', row: { id: ref.localId, kind: 'boundary', span: [node.getStart(doc.sourceFile),node.end], scope: null,
      data: { modelId: 'typescript-default-library/worker-source/' + kind, modelVersion: '1', invocation, boundaryKind: kind, fromContext: fromContext || 'source:' + doc.item.source.sourceUnitId, toContext } } }); return ref;
  };
  const edge = (doc, kind, from, to, callSite, operandOrdinal = null) => { if (from && to) ledgers.get(doc).edges.push({ kind, from, to, callSite, operandOrdinal, contextKey: group.context.contextKey, condition: null, evidence: ledgers.get(doc).evidence, certainty: 'modeled' }); };
  const signature = (doc,node) => doc.checker.getResolvedSignature(node)?.declaration;
  const resolveWorker = (doc,node,seen = new Set()) => {
    const { ts, checker } = doc;
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) return resolveWorker(doc,node.expression,seen);
    if (ts.isNewExpression(node)) return authority(doc,signature(doc,node),['Worker']) ? node : null;
    if (!ts.isIdentifier(node)) return null;
    const symbol = checker.getSymbolAtLocation(node); if (seen.size >= 32) { ledgers.get(doc).reasons.add('worker_receiver_alias_budget'); return null; }
    if (!symbol || seen.has(symbol)) return null; seen.add(symbol);
    const declarations = (symbol.declarations || []).filter(value => ts.isVariableDeclaration(value) && value.getSourceFile() === doc.sourceFile && value.initializer && (value.parent.flags & ts.NodeFlags.Const));
    return declarations.length === 1 ? resolveWorker(doc,declarations[0].initializer,seen) : null;
  };
  const literalEntry = (doc,worker) => {
    const { ts } = doc, argument = worker.arguments?.[0]; if (!argument || !ts.isNewExpression(argument) || !authority(doc,signature(doc,argument),['URL'])) return null;
    const [literal,base] = argument.arguments || []; if (!literal || !(ts.isStringLiteral(literal) || ts.isNoSubstitutionTemplateLiteral(literal)) || !base || !ts.isPropertyAccessExpression(base) || base.name.text !== 'url' || !ts.isMetaProperty(base.expression) || base.expression.keywordToken !== ts.SyntaxKind.ImportKeyword || base.expression.name.text !== 'meta') return null;
    // A bare string Worker URL depends on ambient document base, so only import.meta.url is anchored.
    if (!literal.text.startsWith('.') || /[?#\\]/.test(literal.text) || !doc.containerPath && doc.item.source.mapping) return null;
    const container = doc.containerPath || doc.item.source.path;
    const target = keyPath(path.resolve(group.repoRoot,path.dirname(container),literal.text));
    return entries.get(target)?.length === 1 ? entries.get(target)[0] : null;
  };
  const handlerFor = (doc,node) => {
    const { ts, checker } = doc;
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return node;
    if (!ts.isIdentifier(node)) return null;
    const declarations = checker.getSymbolAtLocation(node)?.declarations || [];
    const handlers = declarations.map(value => ts.isFunctionDeclaration(value) ? value : ts.isVariableDeclaration(value) && (value.parent.flags & ts.NodeFlags.Const) ? value.initializer : null).filter(value => value && value.getSourceFile() === doc.sourceFile && ts.isFunctionLike(value));
    return handlers.length === 1 ? handlers[0] : null;
  };
  const consumers = new Map();
  for (const doc of documents) {
    const { ts,checker } = doc, found = [], dataBySymbol = new Map();
    for (const candidate of doc.nodes) if (ts.isPropertyAccessExpression(candidate) && candidate.name.text === 'data' && ts.isIdentifier(candidate.expression)) {
      const symbol = checker.getSymbolAtLocation(candidate.expression), declarations = checker.getSymbolAtLocation(candidate.name)?.declarations || [];
      if (symbol && declarations.some(declaration => authority(doc,declaration,['data'])) && platformType(doc,candidate.expression,['MessageEvent'])) {
        const ref = doc.expressionFor(candidate); if (ref) { if (!dataBySymbol.has(symbol)) dataBySymbol.set(symbol,[]); dataBySymbol.get(symbol).push({node:candidate,ref}); }
      }
    }
    for (const node of doc.nodes) {
      throwIfAborted(signal); let callback = null, site = null, receiverWorker = null;
      if (ts.isCallExpression(node) && node.arguments.length >= 2 && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'message') {
        const callee = node.expression, declaration = signature(doc,node);
        const property = ts.isPropertyAccessExpression(callee), name = property ? callee.name.text : ts.isIdentifier(callee) ? callee.text : '';
        if (name === 'addEventListener' && authority(doc,declaration,['addEventListener'],['lib.webworker.d.ts']) && (!property || platformType(doc,callee.expression,['DedicatedWorkerGlobalScope'],['lib.webworker.d.ts']))) { callback = handlerFor(doc,node.arguments[1]); site = node; }
        else if (name === 'addEventListener' && property && authority(doc, declaration, ['addEventListener'])
          && platformType(doc, callee.expression, ['Worker'])) {
          receiverWorker = resolveWorker(doc, callee.expression);
          if (receiverWorker) { callback = handlerFor(doc, node.arguments[1]); site = node; }
          else ledgers.get(doc).reasons.add('worker_response_receiver_alias_or_entry_unresolved');
        }
      } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const target = node.left, property = ts.isPropertyAccessExpression(target), name = property ? target.name.text : ts.isIdentifier(target) ? target.text : '';
        const declarations = checker.getSymbolAtLocation(property ? target.name : target)?.declarations || [];
        if (name === 'onmessage' && declarations.some(declaration => authority(doc,declaration,['onmessage'],['lib.webworker.d.ts'])) && (!property || platformType(doc,target.expression,['DedicatedWorkerGlobalScope'],['lib.webworker.d.ts']))) { callback = handlerFor(doc,node.right); site = node; }
        else if (name === 'onmessage' && property && declarations.some(declaration => authority(doc, declaration, ['onmessage']))
          && platformType(doc, target.expression, ['Worker'])) {
          receiverWorker = resolveWorker(doc, target.expression);
          if (receiverWorker) { callback = handlerFor(doc, node.right); site = node; }
          else ledgers.get(doc).reasons.add('worker_response_receiver_alias_or_entry_unresolved');
        }
      }
      if (!callback || !site) continue;
      const parameter = callback.parameters[0]; if (!parameter || !ts.isIdentifier(parameter.name)) { ledgers.get(doc).reasons.add('message_parameter_binding_pattern_unsupported'); continue; }
      const symbol = checker.getSymbolAtLocation(parameter.name), invocation = doc.expressionFor(site); if (!symbol || !invocation) continue;
      const data = (dataBySymbol.get(symbol) || []).filter(value => value.node.pos >= callback.pos && value.node.end <= callback.end).map(value => value.ref);
      if (data.length) found.push({ site,invocation,data,receiverWorker }); else ledgers.get(doc).reasons.add('message_data_consumer_unavailable');
    }
    consumers.set(doc,found);
  }
  const enabledFor = doc => !['off','deferred'].includes((doc.policy || argumentsPolicy).enrichment.crossFileFlow);
  for (const doc of documents) if (enabledFor(doc)) for (const observation of doc.observations) {
    throwIfAborted(signal);
    if (!observation.invocation || !observation.node) continue;
    if (doc.ts.isNewExpression(observation.node) && authority(doc,observation.signatureDeclaration,['Worker'])) {
      const entry = literalEntry(doc,observation.node), invocation = doc.expressionFor(observation.node), ledger = ledgers.get(doc); ledger.observed++;
      if (invocation) { const construction = boundary(doc,observation.node,'worker-source-construction-request',invocation,entry ? 'source:' + entry.item.source.sourceUnitId : null); edge(doc,'dispatches',invocation,construction,invocation); }
      if (!entry) ledger.reasons.add('worker_entry_dynamic_or_not_in_exact_inventory');
      ledger.reasons.add('worker_execution_and_runtime_realm_unobserved'); continue;
    }
    if (!doc.ts.isCallExpression(observation.node) || !authority(doc,observation.signatureDeclaration,['postMessage'])) continue;
    const call = observation.node;
    const propertyCall = doc.ts.isPropertyAccessExpression(call.expression);
    const workerGlobal = authority(doc, observation.signatureDeclaration, ['postMessage'], ['lib.webworker.d.ts'])
      && (!propertyCall && doc.ts.isIdentifier(call.expression)
        || propertyCall && platformType(doc, call.expression.expression, ['DedicatedWorkerGlobalScope'], ['lib.webworker.d.ts']));
    if (workerGlobal) {
      const ledger = ledgers.get(doc), invocation = doc.expressionFor(call);
      if (!invocation) { ledger.reasons.add('dispatch_syntax_anchor_unavailable'); continue; }
      ledger.observed++;
      const dispatch = boundary(doc, call, 'worker-response-dispatch-request', invocation);
      edge(doc, 'dispatches', invocation, dispatch, invocation);
      if (call.arguments[0]) {
        edge(doc, 'consumes', doc.expressionFor(call.arguments[0]), dispatch, invocation, 0);
        const clone = boundary(doc, call.arguments[0], 'worker-response-clone-request', invocation);
        edge(doc, 'packs', doc.expressionFor(call.arguments[0]), clone, invocation, 0);
        edge(doc, 'dispatches', clone, dispatch, invocation);
      }
      let matched = 0;
      for (const [host, registrations] of consumers) if (enabledFor(host)) for (const consumer of registrations) {
        if (!consumer.receiverWorker || literalEntry(host, consumer.receiverWorker) !== doc) continue;
        const receive = boundary(host, consumer.site, 'worker-source-response-consumer-candidate', consumer.invocation,
          'source:' + host.item.source.sourceUnitId, 'source:' + doc.item.source.sourceUnitId);
        edge(doc, 'dispatches', dispatch, receive, invocation);
        for (const target of consumer.data) edge(host, 'consumes', receive, target, invocation, 0);
        matched++;
        ledgers.get(host).reasons.add('response_registration_order_instance_and_delivery_unobserved');
      }
      if (matched) ledger.completed++;
      else ledger.reasons.add('worker_response_consumer_or_constructor_unresolved');
      if (call.arguments.length > 1) ledger.reasons.add('worker_response_transfer_effects_unresolved');
      ledger.reasons.add('response_correlation_instance_and_runtime_delivery_unobserved');
      continue;
    }
    if (!propertyCall || !platformType(doc,call.expression.expression,['Worker'])) continue;
    const ledger = ledgers.get(doc); ledger.observed++;
    const worker = resolveWorker(doc,call.expression.expression), entry = worker && literalEntry(doc,worker), invocation = doc.expressionFor(call);
    if (!invocation) { ledger.reasons.add('dispatch_syntax_anchor_unavailable'); continue; }
    const dispatch = boundary(doc,call,'worker-message-dispatch-request',invocation,entry ? 'source:' + entry.item.source.sourceUnitId : null);
    edge(doc,'dispatches',invocation,dispatch,invocation); const payload = call.arguments[0]; if (payload) edge(doc,'consumes',doc.expressionFor(payload),dispatch,invocation,0);
    const transferArg = call.arguments[1]; let transfer = null;
    if (transferArg && doc.ts.isArrayLiteralExpression(transferArg)) transfer = transferArg;
    else if (transferArg && doc.ts.isObjectLiteralExpression(transferArg)) { const property = transferArg.properties.find(property => doc.ts.isPropertyAssignment(property) && (doc.ts.isIdentifier(property.name) || doc.ts.isStringLiteral(property.name)) && property.name.text === 'transfer'); if (property && doc.ts.isArrayLiteralExpression(property.initializer)) transfer = property.initializer; else ledger.reasons.add('transfer_options_dynamic'); }
    else if (transferArg) ledger.reasons.add('transfer_list_dynamic');
    if (transfer) for (const element of transfer.elements) {
      if (doc.ts.isSpreadElement(element) || doc.ts.isOmittedExpression(element)) { ledger.reasons.add('transfer_list_spread_or_hole'); continue; }
      if (platformType(doc,element,['SharedArrayBuffer'])) { ledger.reasons.add('shared_buffer_not_transferable'); continue; }
      const request = boundary(doc,element,'worker-transfer-request',invocation,entry ? 'source:' + entry.item.source.sourceUnitId : null); edge(doc,'transfers',doc.expressionFor(element),request,invocation,1); edge(doc,'dispatches',request,dispatch,invocation);
    }
    if (payload) {
      const clone = boundary(doc,payload,'worker-structured-clone-request',invocation,entry ? 'source:' + entry.item.source.sourceUnitId : null); edge(doc,'packs',doc.expressionFor(payload),clone,invocation,0); edge(doc,'dispatches',clone,dispatch,invocation);
      // Shared fields retain a separate storage request, never a transfer edge.
      const pending = [{ node: payload,depth:0 }], seen = new Set();
      while (pending.length) { const {node,depth} = pending.pop(); if (seen.has(node)) continue; seen.add(node);
        if (doc.ts.isIdentifier(node)) {
          const declarations = doc.checker.getSymbolAtLocation(node)?.declarations || [];
          const local = declarations.filter(declaration => doc.ts.isVariableDeclaration(declaration) && declaration.getSourceFile() === doc.sourceFile && declaration.initializer && (declaration.parent.flags & doc.ts.NodeFlags.Const));
          if (local.length === 1 && !seen.has(local[0].initializer)) pending.push({node:local[0].initializer,depth});
        }
        if (platformType(doc,node,['SharedArrayBuffer'])) { const shared = boundary(doc,node,'worker-shared-storage-request',invocation); edge(doc,'sharesStorage',doc.expressionFor(node),shared,invocation,0); edge(doc,'dispatches',shared,dispatch,invocation); continue; }
        if (depth >= (doc.policy || argumentsPolicy).enrichment.fieldPathDepth) { if (doc.ts.isObjectLiteralExpression(node) || doc.ts.isArrayLiteralExpression(node)) ledger.reasons.add('shared_field_depth_budget'); continue; }
        if (doc.ts.isObjectLiteralExpression(node)) for (const property of node.properties) { const value = doc.ts.isPropertyAssignment(property) ? property.initializer : doc.ts.isShorthandPropertyAssignment(property) ? property.name : null; if (value) pending.push({node:value,depth:depth+1}); else ledger.reasons.add('shared_field_spread_or_computed'); }
        else if (doc.ts.isArrayLiteralExpression(node)) for (const value of node.elements) if (!doc.ts.isOmittedExpression(value) && !doc.ts.isSpreadElement(value)) pending.push({node:value,depth:depth+1});
      }
    }
    if (!worker || !entry) { ledger.reasons.add(worker ? 'worker_entry_dynamic_or_not_in_exact_inventory' : 'worker_receiver_alias_or_mutation_unresolved'); continue; }
    const targets = consumers.get(entry).filter(consumer => !consumer.receiverWorker); if (!targets.length) { ledger.reasons.add('worker_entry_message_consumer_unavailable'); continue; }
    for (const consumer of targets) {
      const receive = boundary(entry,consumer.site,'worker-source-message-consumer-candidate',consumer.invocation,'source:' + entry.item.source.sourceUnitId,'source:' + doc.item.source.sourceUnitId);
      edge(doc,'dispatches',dispatch,receive,invocation); for (const target of consumer.data) edge(entry,'consumes',receive,target,invocation,0);
    }
    ledger.completed++; ledger.reasons.add('runtime_delivery_and_handler_activation_unobserved');
  }
  for (const doc of documents) {
    const ledger = ledgers.get(doc); if (!ledger.observed && !ledger.rows.some(row => row.row.kind === 'boundary')) continue;
    const sorted = [...new Map(ledger.edges.map(edge => [canonicalSemanticJson(edge),edge])).entries()].sort(([a],[b])=>a<b?-1:a>b?1:0); sorted.forEach(([,edge],id)=>ledger.rows.push({family:'edge',row:{id,...edge}}));
    const coverage = { scope:{sourceUnitId:doc.item.source.sourceUnitId},phase:'boundaryModels',state:'partial',reason:[...new Set([...ledger.reasons,'source_candidates_only_runtime_delivery_and_clone_effects_unobserved'])].sort().join(';'),observedCount:ledger.observed,completedCount:ledger.completed,frontierRef:null };
    ledger.rows.push({family:'coverage',row:coverage});
    const policy = doc.policy || argumentsPolicy;
    const partition = await writeSemanticAnalysis({rows:ledger.rows,policy,stagingRoot:doc.item.root,source:doc.item.source,sourceBytes:doc.bytes,partitionId:ledger.partitionId,producerHash:semanticHash('semantic.worker-source-producer.v1',{version:2}),policyHash:semanticHash('semantic.worker-source-policy.v1',policy.enrichment),contextHash:group.context.contextKey,diskAccount:state.semanticDiskAccount,signal});
    const current=state.semanticFactsByFile.get(doc.item.file); state.semanticFactsByFile.set(doc.item.file,createSemanticFactsRef({source:doc.item.source,storage:current.storage,syntaxPartitionId:current.syntaxPartitionId,partitions:[...current.partitions.filter(row=>row.partitionId!==partition.partitionId),partition],coverage:[...current.coverage,coverage]})); output.push(partition);
  }
  return output;
};
