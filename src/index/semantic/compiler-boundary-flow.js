import path from 'node:path';
import { createHash } from 'node:crypto';
import { createAnalysisPartitionId, semanticHash, canonicalSemanticJson } from './identity.js';
import { createSemanticFactsRef } from './file-ref.js';
import { writeSemanticAnalysis } from './analysis-write.js';
import { persistSemanticEvidence } from './lsp-evidence.js';
import { createCompilerBoundaryAuthority } from './compiler-boundary-authority.js';
import { throwIfAborted } from '../../shared/abort.js';
const keyPath = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const digest = text => createHash('sha256').update(text, 'utf8').digest('hex');
const literal = (ts, node) => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
const sameModule = (authority, name) => authority?.family === 'node-type-package' && [name, 'node:' + name].includes(authority.moduleName);
const has = (authority, name) => authority?.names.includes(name);
const defaultLibrary = authority => authority?.family === 'typescript-default-library';
/** Requests and source dispatch candidates are modeled evidence, never observed execution. */
export const collectCompilerBoundaryFlow = async ({ group, state, policy, signal = null }) => {
  throwIfAborted(signal);
  const documents = [...(group.workerDocuments || [])].sort((a, b) => order(a.item.source.sourceUnitId, b.item.source.sourceUnitId));
  const sourceHashes = new WeakMap();
  const sourceHash = source => { if (!sourceHashes.has(source)) sourceHashes.set(source, digest(source.text)); return sourceHashes.get(source); };
  const authority = createCompilerBoundaryAuthority(group), byFile = new Map(), entries = new Map(), ledgers = new Map();
  const inputHashes = documents.map(doc => doc.bindingPartition.canonicalHash).sort(order);
  state.semanticEvidenceArtifacts ||= [];
  for (const doc of documents) {
    byFile.set(keyPath(doc.sourceFile.fileName), doc);
    const container = doc.containerPath || (!doc.item.source.mapping ? doc.item.source.path : null);
    if (container) {
      const key = keyPath(path.resolve(group.repoRoot, container));
      if (!entries.has(key)) entries.set(key, []);
      entries.get(key).push(doc);
    }
    const effective = doc.policy || policy;
    const partitionId = createAnalysisPartitionId({ pass: { name: 'compiler-execution-boundaries', version: '3' }, inputPartitionHashes: inputHashes,
      compilerContext: { contextKey: group.context.contextKey, sourceUnitId: doc.item.source.sourceUnitId }, dependencySummaryHashes: group.dependencyHashes,
      analysisPolicy: { enrichment: effective.enrichment, authorityVersion: 1 } });
    ledgers.set(doc, { partitionId, rows: [], edges: [], reasons: new Set(), nextId: 0, observed: 0, completedSites: new Set(), policy: effective, uses: new Map(), returns: new Map() });
  }
  const enabled = doc => !['off', 'deferred'].includes(ledgers.get(doc).policy.enrichment.localFlow);
  const crossEnabled = doc => !['off', 'deferred'].includes(ledgers.get(doc).policy.enrichment.crossFileFlow);
  const invocationAuthority = async (doc, node) => authority.declaration(doc.checker.getResolvedSignature(node)?.declaration);
  const functionRef = (doc, node) => doc.expressionFor(node) || (node.name ? doc.item.declarations.get(node.name.getStart(doc.sourceFile) + ':' + node.name.end) : null);
  const ownerCache = new WeakMap();
  const owner = (doc, node) => {
    const pending = []; let current = node.parent;
    while (current && !doc.ts.isFunctionLike(current) && !ownerCache.has(current)) { pending.push(current); current = current.parent; }
    const found = current && (ownerCache.get(current) || current);
    for (const value of pending) ownerCache.set(value, found);
    return found;
  };
  // Reuse the provider's existing indexed nodes/observations; do not traverse AST children again.
  for (const doc of documents) {
    const ledger = ledgers.get(doc);
    for (const observation of doc.observations) {
      throwIfAborted(signal);
      const node = observation.node;
      if (!node || !doc.ts.isIdentifier(node) || observation.invocation) continue;
      const ref = doc.expressionFor(node), symbol = doc.checker.getSymbolAtLocation(node);
      if (!ref || !symbol || doc.ts.isParameter(node.parent) && node.parent.name === node) continue;
      if (!ledger.uses.has(symbol)) ledger.uses.set(symbol, []);
      ledger.uses.get(symbol).push({ node, ref });
    }
    for (const node of doc.nodes) if (doc.ts.isArrowFunction(node) && !doc.ts.isBlock(node.body)) ledger.returns.set(node, [node.body]);
    for (const node of doc.nodes) if (doc.ts.isReturnStatement(node) && node.expression) {
      const fn = owner(doc, node); if (!fn) continue;
      if (!ledger.returns.has(fn)) ledger.returns.set(fn, []);
      ledger.returns.get(fn).push(node.expression);
    }
  }
  const handlerFor = (doc, input, seen = new Set()) => {
    if (!input) return null;
    const mapped = byFile.get(keyPath(input.getSourceFile().fileName));
    if (!mapped || sourceHash(input.getSourceFile()) !== mapped.item.source.textHash) return null;
    if (mapped !== doc) return handlerFor(mapped, input, seen);
    const ts = doc.ts;
    if (ts.isParenthesizedExpression(input) || ts.isAsExpression(input) || ts.isNonNullExpression(input)) return handlerFor(doc, input.expression, seen);
    if (ts.isArrowFunction(input) || ts.isFunctionExpression(input) || ts.isFunctionDeclaration(input)) return functionRef(doc, input) ? { doc, node: input, ref: functionRef(doc, input) } : null;
    if (!ts.isIdentifier(input) && !ts.isPropertyAccessExpression(input)) return null;
    let symbol = doc.checker.getSymbolAtLocation(ts.isPropertyAccessExpression(input) ? input.name : input);
    if (!symbol || seen.has(symbol) || seen.size >= 32) { ledgers.get(doc).reasons.add('callback_alias_budget_or_cycle'); return null; }
    seen.add(symbol);
    if (symbol.flags & ts.SymbolFlags.Alias) symbol = doc.checker.getAliasedSymbol(symbol);
    const candidates = [];
    for (const declaration of symbol?.declarations || []) {
      const target = byFile.get(keyPath(declaration.getSourceFile().fileName));
      if (!target || sourceHash(declaration.getSourceFile()) !== target.item.source.textHash) continue;
      if (ts.isFunctionDeclaration(declaration)) candidates.push(handlerFor(target, declaration, seen));
      else if (ts.isVariableDeclaration(declaration) && declaration.initializer && declaration.parent.flags & ts.NodeFlags.Const) candidates.push(handlerFor(target, declaration.initializer, seen));
    }
    const unique = [...new Map(candidates.filter(Boolean).map(value => [canonicalSemanticJson(value.ref), value])).values()];
    return unique.length === 1 ? unique[0] : null;
  };
  const evidenceFor = async (doc, node, model, verified) => {
    const ledger = ledgers.get(doc), invocation = doc.expressionFor(node);
    const artifactRef = await persistSemanticEvidence({ value: { schemaVersion: 1, kind: 'compiler-execution-boundary-authority', model,
      sourceUnitId: doc.item.source.sourceUnitId, sourceHash: doc.item.source.byteHash, coordinateUnit: 'utf16', sourceRange: [node.getStart(doc.sourceFile), node.end],
      invocation, contextKey: group.context.contextKey, authority: verified, claim: 'static-request-or-source-dispatch-candidate' }, stagingRoot: doc.item.root,
    diskAccount: state.semanticDiskAccount, inventory: state.semanticEvidenceArtifacts, signal });
    const ref = { partitionId: ledger.partitionId, localId: ledger.nextId++ };
    ledger.rows.push({ family: 'node', row: { id: ref.localId, kind: 'evidence', span: [node.getStart(doc.sourceFile), node.end], scope: null,
      data: { method: 'compiler-platform-execution-boundary', producerId: 'semantic-boundary', producerVersion: '3', evidenceKind: 'modeled', sourceRef: doc.item.source.sourceUnitId, artifactRef } } });
    return ref;
  };
  const boundary = (doc, node, model, invocation, toContext = null) => {
    const ledger = ledgers.get(doc), ref = { partitionId: ledger.partitionId, localId: ledger.nextId++ };
    ledger.rows.push({ family: 'node', row: { id: ref.localId, kind: 'boundary', span: [node.getStart(doc.sourceFile), node.end], scope: null,
      data: { modelId: 'compiler-platform/' + model, modelVersion: '1', invocation, boundaryKind: model, fromContext: 'source:' + doc.item.source.sourceUnitId, toContext } } });
    return ref;
  };
  const edge = (doc, evidence, kind, from, to, callSite, ordinal = null) => {
    if (from && to) ledgers.get(doc).edges.push({ kind, from, to, callSite, operandOrdinal: ordinal, contextKey: group.context.contextKey, condition: null, evidence, certainty: 'modeled' });
  };
  const callback = (doc, node, request, input, ordinal, evidence, kind, payloads = []) => {
    const ledger = ledgers.get(doc), invocation = doc.expressionFor(node), handler = handlerFor(doc, input);
    if (!handler || handler.doc !== doc && !crossEnabled(doc)) { ledger.reasons.add('callback_dynamic_or_source_inventory_unavailable'); return; }
    const candidate = boundary(doc, node, kind + '-source-callback-candidate', invocation, 'source:' + handler.doc.item.source.sourceUnitId);
    edge(doc, evidence, 'dispatches', request, candidate, invocation, ordinal);
    edge(doc, evidence, 'dispatches', candidate, handler.ref, invocation, ordinal);
    for (let index = 0; index < payloads.length; index += 1) {
      const parameter = handler.node.parameters[index], payload = payloads[index];
      if (!parameter || !handler.doc.ts.isIdentifier(parameter.name) || parameter.dotDotDotToken || !payload) { ledger.reasons.add('callback_payload_parameter_mapping_unresolved'); continue; }
      const symbol = handler.doc.checker.getSymbolAtLocation(parameter.name);
      const inputs = ledgers.get(handler.doc).uses.get(symbol) || [];
      for (const use of inputs) if (use.node.pos >= handler.node.pos && use.node.end <= handler.node.end) { edge(doc, evidence, 'consumes', payload, candidate, invocation, index); edge(doc, evidence, 'consumes', candidate, use.ref, invocation, index); }
    }
    ledger.completedSites.add(node); ledger.reasons.add('callback_activation_order_multiplicity_and_effects_unobserved');
    return handler;
  };
  const anchoredEntry = async (doc, argument) => {
    if (!argument || !doc.ts.isNewExpression(argument)) return null;
    const verified = await invocationAuthority(doc, argument);
    if (!(defaultLibrary(verified) && has(verified, 'URL') || sameModule(verified, 'url') && has(verified, 'URL'))) return null;
    const [name, base] = argument.arguments || [], value = literal(doc.ts, name);
    if (!value || !value.startsWith('.') || /[?#\\]/.test(value) || !base || !doc.ts.isPropertyAccessExpression(base) || base.name.text !== 'url' || !doc.ts.isMetaProperty(base.expression) || base.expression.keywordToken !== doc.ts.SyntaxKind.ImportKeyword) return null;
    const container = doc.containerPath || (!doc.item.source.mapping ? doc.item.source.path : null);
    const found = container && entries.get(keyPath(path.resolve(group.repoRoot, path.dirname(container), value)));
    return found?.length === 1 ? found[0] : null;
  };
  const launches = new WeakMap(), settlements = new WeakMap(), consumers = new Map();
  for (const doc of documents) {
    const found = [];
    for (const observation of doc.observations) {
      throwIfAborted(signal);
      const node = observation.node; if (!observation.invocation || !node || !doc.ts.isCallExpression(node)) continue;
      const verified = await authority.declaration(observation.signatureDeclaration);
      if (defaultLibrary(verified) && has(verified, 'PromiseConstructor') && (has(verified, 'resolve') || has(verified, 'reject'))) settlements.set(node, { kind: has(verified, 'reject') ? 'reject' : 'resolve', payload: doc.expressionFor(node.arguments[0]) });
      if (sameModule(verified, 'child_process') && has(verified, 'fork')) launches.set(node, await anchoredEntry(doc, node.arguments[0]));
      if (!doc.ts.isPropertyAccessExpression(node.expression) || literal(doc.ts, node.arguments[0]) !== 'message') continue;
      if (!has(verified, 'on') && !has(verified, 'once') && !has(verified, 'addListener')) continue;
      const receiver = await authority.type(doc, node.expression.expression, ['Process']);
      if (!receiver?.every(value => value.family === 'node-type-package' && value.library === 'process.d.ts') || !verified || verified.family !== 'node-type-package') continue;
      const handler = handlerFor(doc, node.arguments[1]);
      if (handler) found.push({ node, handler, verified, receiver });
    }
    consumers.set(doc, found);
  }
  const settlementFor = (doc, input, seen = new Set()) => {
    if (!input) return null;
    if (settlements.has(input)) return settlements.get(input);
    if (!doc.ts.isIdentifier(input)) return null;
    const symbol = doc.checker.getSymbolAtLocation(input);
    if (!symbol || seen.has(symbol) || seen.size >= 32) { ledgers.get(doc).reasons.add('promise_receiver_alias_budget_or_cycle'); return null; }
    seen.add(symbol);
    const declarations = (symbol.declarations || []).filter(node => doc.ts.isVariableDeclaration(node) && node.initializer && node.getSourceFile() === doc.sourceFile && node.parent.flags & doc.ts.NodeFlags.Const);
    return declarations.length === 1 ? settlementFor(doc, declarations[0].initializer, seen) : null;
  };
  const forkFor = (doc, input, seen = new Set()) => {
    if (!input) return null;
    if (launches.has(input)) return { node: input, entry: launches.get(input) };
    if (!doc.ts.isIdentifier(input)) return null;
    const symbol = doc.checker.getSymbolAtLocation(input);
    if (!symbol || seen.has(symbol) || seen.size >= 32) { ledgers.get(doc).reasons.add('process_receiver_alias_budget_or_cycle'); return null; }
    seen.add(symbol);
    const declarations = (symbol.declarations || []).filter(node => doc.ts.isVariableDeclaration(node) && node.initializer && node.getSourceFile() === doc.sourceFile && node.parent.flags & doc.ts.NodeFlags.Const);
    return declarations.length === 1 ? forkFor(doc, declarations[0].initializer, seen) : null;
  };
  for (const doc of documents) {
    if (!enabled(doc)) continue;
    const ledger = ledgers.get(doc), ts = doc.ts;
    for (const observation of doc.observations) {
      throwIfAborted(signal);
      const node = observation.node, invocation = node && doc.expressionFor(node);
      if (!observation.invocation || !node || !invocation) continue;
      let verified = await authority.declaration(observation.signatureDeclaration);
      let wasmExport = false;
      if (ts.isCallExpression(node) && (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression))) {
        const types = await authority.type(doc, node.expression.expression, ['Exports']);
        if (types?.length && types.every(value => defaultLibrary(value) && has(value, 'WebAssembly'))) { verified = types[0]; wasmExport = true; }
      }
      if (!verified) continue;
      const args = node.arguments || [], names = verified.names;
      const promiseMethod = defaultLibrary(verified) && names.includes('Promise') && ['then', 'catch', 'finally'].find(name => names.includes(name));
      const promiseAction = defaultLibrary(verified) && has(verified, 'PromiseConstructor') && ['resolve', 'reject', 'all', 'allSettled', 'race', 'any'].find(name => names.includes(name));
      const promiseExecutor = defaultLibrary(verified) && has(verified, 'PromiseConstructor') && ts.isNewExpression(node);
      const timer = (defaultLibrary(verified) || sameModule(verified, 'timers') || verified.family === 'node-type-package' && verified.library === 'web-globals/timers.d.ts') && ['queueMicrotask', 'setTimeout', 'setInterval'].find(name => names.includes(name));
      const event = defaultLibrary(verified) && names.includes('addEventListener') && ['lib.dom.d.ts', 'lib.webworker.d.ts'].includes(verified.library);
      if (promiseMethod || promiseAction || promiseExecutor || timer || event) {
        ledger.observed += 1;
        const kind = promiseMethod ? 'promise-' + promiseMethod + '-continuation-request' : promiseAction ? 'promise-' + promiseAction + '-settlement-request' : promiseExecutor ? 'promise-executor-request' : timer ? timer + '-callback-request' : 'event-listener-request';
        const evidence = await evidenceFor(doc, node, kind, verified), request = boundary(doc, node, kind, invocation, 'logical-scheduler:' + doc.item.source.sourceUnitId);
        edge(doc, evidence, 'dispatches', invocation, request, invocation);
        if (promiseMethod) {
          if (!ts.isPropertyAccessExpression(node.expression)) { ledger.reasons.add('promise_receiver_unmapped'); continue; }
          edge(doc, evidence, 'consumes', doc.expressionFor(node.expression.expression), request, invocation);
          const count = promiseMethod === 'then' ? 2 : 1;
          for (let index = 0; index < count; index += 1) if (args[index] && args[index].kind !== ts.SyntaxKind.NullKeyword) {
            const settlement = settlementFor(doc, node.expression.expression);
            const channelMatches = promiseMethod === 'then' ? index === 0 && settlement?.kind === 'resolve' || index === 1 && settlement?.kind === 'reject' : promiseMethod === 'catch' && settlement?.kind === 'reject';
            const handler = callback(doc, node, request, args[index], index, evidence, 'promise-' + promiseMethod, channelMatches ? [settlement.payload] : []);
            if (handler && promiseMethod !== 'finally') for (const result of ledgers.get(handler.doc).returns.get(handler.node) || []) edge(doc, evidence, 'packs', handler.doc.expressionFor(result), request, invocation, index);
          }
          edge(doc, evidence, 'packs', request, invocation, invocation);
          ledger.reasons.add('promise_settlement_payload_assimilation_rejection_and_branch_unresolved');
        } else if (promiseAction) {
          for (let index = 0; index < args.length; index += 1) edge(doc, evidence, 'consumes', doc.expressionFor(args[index]), request, invocation, index);
          edge(doc, evidence, 'packs', request, invocation, invocation);
          ledger.reasons.add('promise_assimilation_iterable_order_settlement_and_rejection_unresolved');
        } else if (promiseExecutor) {
          callback(doc, node, request, args[0], 0, evidence, 'promise-executor');
          ledger.reasons.add('promise_resolver_rejector_capabilities_and_settlement_unresolved');
        } else if (timer) {
          const payloads = timer === 'queueMicrotask' ? [] : args.slice(2).map(value => ts.isSpreadElement(value) ? null : doc.expressionFor(value));
          callback(doc, node, request, args[0], 0, evidence, timer, payloads);
        } else {
          edge(doc, evidence, 'consumes', doc.expressionFor(args[0]), request, invocation, 0);
          callback(doc, node, request, args[1], 1, evidence, 'event-listener');
          ledger.reasons.add('event_object_and_delivery_source_unresolved');
        }
        continue;
      }
      const launch = sameModule(verified, 'child_process') && ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'].find(name => names.includes(name));
      const ipc = verified.family === 'node-type-package' && names.includes('send') && (sameModule(verified, 'child_process') || verified.library === 'process.d.ts');
      const native = verified.family === 'node-type-package' && (names.includes('dlopen') && verified.library === 'process.d.ts' || names.includes('Require') && literal(ts, args[0])?.endsWith('.node'));
      const wasm = defaultLibrary(verified) && names.includes('WebAssembly');
      if (!launch && !ipc && !native && !wasm) continue;
      ledger.observed += 1;
      const memoryGrowth = wasm && names.includes('Memory') && names.includes('grow');
      const kind = wasmExport ? 'wasm-export-entry-request' : memoryGrowth ? 'wasm-memory-growth-request' : launch ? 'child-process-' + launch + '-launch-request' : ipc ? 'process-ipc-dispatch-request' : native ? 'native-addon-entry-request' : 'wasm-entry-request';
      const evidence = await evidenceFor(doc, node, kind, verified);
      const entry = launch === 'fork' ? launches.get(node) : null;
      const request = boundary(doc, node, kind, invocation, entry ? 'source:' + entry.item.source.sourceUnitId : null);
      edge(doc, evidence, 'dispatches', invocation, request, invocation);
      for (let index = 0; index < args.length; index += 1) edge(doc, evidence, 'consumes', doc.expressionFor(args[index]), request, invocation, index);
      if (wasmExport || memoryGrowth) {
        const result = { partitionId: ledger.partitionId, localId: ledger.nextId++ };
        ledger.rows.push({ family: 'node', row: { id: result.localId, kind: 'value',
          span: [node.getStart(doc.sourceFile), node.end], scope: null,
          data: { origin: 'unknown', site: invocation, storage: null } } });
        edge(doc, evidence, 'returns', request, result, invocation);
        edge(doc, evidence, 'returnToResult', result, invocation, invocation);
        ledger.reasons.add('wasm_result_value_conversion_and_traps_unresolved');
      }
      if (memoryGrowth && ts.isPropertyAccessExpression(node.expression)) {
        edge(doc, evidence, 'mutates', request, doc.expressionFor(node.expression.expression), invocation);
        ledger.reasons.add('wasm_memory_growth_success_and_old_view_epoch_unobserved');
      }
      if (launch) {
        if (entry) ledger.reasons.add('process_entry_source_inventory_candidate_only');
        if (!entry) ledger.reasons.add('process_executable_cwd_environment_or_entry_dynamic');
        if (['exec', 'execFile'].includes(launch)) {
          const index = args.length - 1;
          if (index >= 1) callback(doc, node, request, args[index], index, evidence, 'process-completion');
        }
        ledger.reasons.add('process_launch_success_pid_runtime_realm_and_effects_unobserved');
      } else if (ipc) {
        const receiver = ts.isPropertyAccessExpression(node.expression) ? node.expression.expression : null;
        const fork = receiver && forkFor(doc, receiver), target = fork?.entry;
        if (!target || !crossEnabled(doc)) ledger.reasons.add('ipc_peer_entry_or_runtime_channel_unresolved');
        else for (const consumer of consumers.get(target) || []) {
          const peerEvidence = await evidenceFor(doc, node, 'process-ipc-peer-registration-candidate', { sender: verified, peer: { sourceUnitId: target.item.source.sourceUnitId, sourceHash: target.item.source.byteHash, registration: target.expressionFor(consumer.node), authority: consumer.verified, receiver: consumer.receiver } });
          callback(doc, node, request, consumer.handler.node, 0, peerEvidence, 'process-ipc-consumer', [doc.expressionFor(args[0])]);
        }
        // Serialization is a request; no copies/transfers/sharesStorage are asserted for IPC payloads.
        edge(doc, evidence, 'packs', doc.expressionFor(args[0]), request, invocation, 0);
        ledger.reasons.add('ipc_serialization_handle_effects_delivery_and_listener_activation_unobserved');
      } else if (native) ledger.reasons.add('native_module_body_abi_initialization_and_storage_effects_unavailable');
      else {
        if (names.includes('Memory') || names.includes('MemoryConstructor')) ledger.reasons.add('wasm_memory_shared_descriptor_growth_and_alias_effects_unresolved');
        const imports = names.includes('instantiate') || names.includes('instantiateStreaming') ? args[1] : names.includes('Instance') || names.includes('InstanceConstructor') ? args[1] : null;
        if (imports && ts.isObjectLiteralExpression(imports)) for (const namespace of imports.properties) {
          if (!ts.isPropertyAssignment(namespace) || !ts.isObjectLiteralExpression(namespace.initializer)) { ledger.reasons.add('wasm_import_namespace_dynamic'); continue; }
          for (const property of namespace.initializer.properties) {
            const value = ts.isPropertyAssignment(property) ? property.initializer : ts.isShorthandPropertyAssignment(property) ? property.name : null;
            if (value) callback(doc, node, request, value, 1, evidence, 'wasm-host-import');
            else ledger.reasons.add('wasm_import_accessor_or_spread_unresolved');
          }
        }
        ledger.reasons.add('wasm_binary_exports_import_activation_native_realm_and_memory_effects_unavailable');
      }
    }
    for (const node of doc.nodes) {
      throwIfAborted(signal);
      if (!ts.isPropertyAccessExpression(node)) continue;
      const verified = await authority.declaration(doc.checker.getSymbolAtLocation(node.name)?.declarations?.[0]);
      if (!defaultLibrary(verified) || !has(verified, 'WebAssembly')) continue;
      if (has(verified, 'buffer') && has(verified, 'Memory')) {
        const invocation = doc.expressionFor(node); if (!invocation) continue;
        ledger.observed += 1;
        const evidence = await evidenceFor(doc, node, 'wasm-memory-buffer-storage-candidate', verified);
        const request = boundary(doc, node, 'wasm-memory-buffer-storage-candidate', invocation);
        edge(doc, evidence, 'sharesStorage', doc.expressionFor(node.expression), request, invocation);
        edge(doc, evidence, 'sharesStorage', request, invocation, invocation);
        ledger.reasons.add('wasm_buffer_sharedness_growth_detachment_and_runtime_identity_unresolved');
      }
    }
  }
  const output = [];
  for (const doc of documents) {
    const ledger = ledgers.get(doc); if (!ledger.observed) continue;
    const sorted = [...new Map(ledger.edges.map(row => [canonicalSemanticJson(row), row])).entries()].sort(([a], [b]) => order(a, b));
    sorted.forEach(([, row], id) => ledger.rows.push({ family: 'edge', row: { id, ...row } }));
    const coverage = { scope: { sourceUnitId: doc.item.source.sourceUnitId }, phase: 'boundaryModels', state: 'partial',
      reason: [...new Set([...ledger.reasons, 'static_candidates_only_no_runtime_thread_delivery_or_effect_claim'])].sort().join(';'), observedCount: ledger.observed, completedCount: ledger.completedSites.size, frontierRef: null };
    ledger.rows.push({ family: 'coverage', row: coverage });
    const partition = await writeSemanticAnalysis({ rows: ledger.rows, policy: ledger.policy, stagingRoot: doc.item.root, source: doc.item.source, sourceBytes: doc.bytes,
      partitionId: ledger.partitionId, producerHash: semanticHash('semantic.execution-boundary-producer.v1', { version: 3 }), policyHash: semanticHash('semantic.execution-boundary-policy.v1', ledger.policy.enrichment),
      contextHash: group.context.contextKey, diskAccount: state.semanticDiskAccount, signal });
    const current = state.semanticFactsByFile.get(doc.item.file);
    state.semanticFactsByFile.set(doc.item.file, createSemanticFactsRef({ source: doc.item.source, storage: current.storage, syntaxPartitionId: current.syntaxPartitionId,
      partitions: [...current.partitions.filter(value => value.partitionId !== partition.partitionId), partition], coverage: [...current.coverage, coverage] }));
    output.push(partition);
  }
  return output;
};
