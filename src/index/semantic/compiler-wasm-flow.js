import { SEMANTIC_ANALYSIS_VERSIONS, WASM_VALIDATOR_RUNTIME } from './analysis-versions.js';
import { persistSemanticEvidence } from './lsp-evidence.js';
import { decodeWasmModule, WASM_LIMITS } from './wasm/decode.js';
import { analyzeWasmModule } from './wasm/flow.js';
import { throwIfAborted } from '../../shared/abort.js';

const library = (value, name) => value?.family === 'typescript-default-library' && value.names.includes(name);
/** Narrow immutable-byte provenance. No filesystem reads, URL guessing, evaluation
 * or mutable typed-array aliases. The existing boundary owner supplies authority,
 * record allocation, callback resolution, publication and disk accounting.
 */
export const createCompilerWasmFlow = ({ group, state, authority, ledgers, handlerFor, crossEnabled, signal }) => {
  const resolutions = new WeakMap(), projections = new WeakMap();
  const resolve = async (doc, input, seen = new Set()) => {
    if (!input || seen.size >= 32 || seen.has(input)) return null;
    seen = new Set(seen).add(input);
    const ts = doc.ts, ledger = ledgers.get(doc);
    if (ts.isParenthesizedExpression(input) || ts.isAsExpression(input) || ts.isNonNullExpression(input)) return resolve(doc, input.expression, seen);
    if (ts.isIdentifier(input)) {
      const symbol = doc.checker.getSymbolAtLocation(input), declarations = symbol?.declarations || [];
      if (declarations.length !== 1) return null;
      const declaration = declarations[0];
      if (!ts.isVariableDeclaration(declaration) || declaration.getSourceFile() !== doc.sourceFile || !(declaration.parent.flags & ts.NodeFlags.Const)) return null;
      const result = await resolve(doc, declaration.initializer, seen);
      // The byte-overload result is an ordinary mutable {module, instance} object.
      // A const binding alone cannot authorize its .instance after writes/escape.
      if (result?.kind === 'instantiated') for (const use of ledger.uses.get(symbol) || []) {
        if (use.node === declaration.name) continue;
        const member = use.node.parent, parent = member.parent;
        const read = ts.isPropertyAccessExpression(member) && member.expression === use.node && member.name.text === 'instance';
        const write = ts.isBinaryExpression(parent) && parent.left === member && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
          || ts.isDeleteExpression(parent) || ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent);
        if (!read || write) { ledger.reasons.add('wasm_instantiation_result_mutation_or_escape'); return null; }
      }
      return result;
    }
    if (ts.isAwaitExpression(input)) {
      const result = await resolve(doc, input.expression, seen);
      return result?.kind.startsWith('promise-') ? { ...result, kind: result.kind.slice(8) } : null;
    }
    if (ts.isPropertyAccessExpression(input) && input.name.text === 'instance') {
      const result = await resolve(doc, input.expression, seen);
      return result?.kind === 'instantiated' ? { ...result, kind: 'instance' } : null;
    }
    if (!ts.isCallExpression(input) && !ts.isNewExpression(input)) return null;
    if (resolutions.has(input)) return resolutions.get(input);
    // Cache only completed resolutions; the caller's seen set fences cycles.
    const verified = await authority.declaration(doc.checker.getResolvedSignature(input)?.declaration);
    if (!library(verified, 'WebAssembly')) return null;
    const names = verified.names, args = input.arguments || [];
    const constructor = ts.isNewExpression(input), isModule = constructor && (names.includes('Module') || names.includes('ModuleConstructor'));
    const isInstance = constructor && (names.includes('Instance') || names.includes('InstanceConstructor'));
    const compile = !constructor && names.includes('compile'), instantiate = !constructor && names.includes('instantiate');
    if (!isModule && !isInstance && !compile && !instantiate) return null;
    let moduleHandle = await resolve(doc, args[0], seen);
    if ((!isInstance && !instantiate) || moduleHandle?.kind !== 'module') moduleHandle = null;
    if (!moduleHandle && !isInstance) {
      const bytesNode = args[0];
      if (bytesNode && ts.isNewExpression(bytesNode) && bytesNode.arguments?.length === 1 && ts.isArrayLiteralExpression(bytesNode.arguments[0])) {
        const byteAuthority = await authority.declaration(doc.checker.getResolvedSignature(bytesNode)?.declaration);
        const elements = bytesNode.arguments[0].elements;
        if (library(byteAuthority, 'Uint8ArrayConstructor') && elements.length <= WASM_LIMITS.bytes && elements.every(element => ts.isNumericLiteral(element) && Number.isInteger(Number(element.text)) && Number(element.text) >= 0 && Number(element.text) <= 255)) {
          const bytes = Buffer.from(elements.map(element => Number(element.text))), decoded = decodeWasmModule(bytes, { signal });
          if (decoded.status === 'decoded') moduleHandle = { kind: 'module', decoded: decoded.module, bytes, byteExpression: doc.expressionFor(bytesNode) };
          else ledger.reasons.add(decoded.reason);
        }
      }
    }
    if (!moduleHandle) { ledger.reasons.add('wasm_exact_module_bytes_unavailable'); resolutions.set(input, null); return null; }
    const result = { ...moduleHandle, creation: input, imports: args[1] || null, authority: verified,
      kind: isModule ? 'module' : compile ? 'promise-module' : isInstance ? 'instance' : (await resolve(doc, args[0], seen))?.kind === 'module' ? 'promise-instance' : 'promise-instantiated' };
    resolutions.set(input, result); return result;
  };
  const project = async (doc, handle) => {
    if (projections.has(handle.creation)) return projections.get(handle.creation);
    const ledger = ledgers.get(doc), module = handle.decoded, invocation = doc.expressionFor(handle.creation);
    let graph;
    try { graph = analyzeWasmModule(module, { signal }); }
    catch (error) { if (error.code !== 'ERR_WASM_FLOW_BUDGET') throw error; ledger.reasons.add('wasm_flow_graph_budget'); return null; }
    const start = ledger.nextId, ref = id => ({ partitionId: ledger.partitionId, localId: start + id });
    const evidence = { partitionId: ledger.partitionId, localId: start + graph.nodes.length };
    const artifactRef = await persistSemanticEvidence({ value: { schemaVersion: 1, kind: 'wasm-binary-analysis',
      producerVersion: SEMANTIC_ANALYSIS_VERSIONS.wasmFlow, validatorRuntime: WASM_VALIDATOR_RUNTIME,
      sourceUnitId: doc.item.source.sourceUnitId, sourceHash: doc.item.source.byteHash,
      invocation, byteExpression: handle.byteExpression, coordinateUnit: 'byte', byteHash: module.byteHash,
      byteLength: module.byteLength, bytesBase64: handle.bytes.toString('base64'), module,
      records: graph.nodes.filter(node => ['instruction', 'function'].includes(node.kind)).map(node => ({
        ref: ref(node.id), kind: node.kind, functionIndex: node.functionIndex ?? node.index,
        byteRange: node.kind === 'instruction' ? [node.offset, node.end] : null
      })) }, stagingRoot: doc.item.root, diskAccount: state.semanticDiskAccount,
    inventory: state.semanticEvidenceArtifacts, signal, maxBytes: 4 * 1024 * 1024 });
    for (const node of graph.nodes) {
      let kind = node.kind, data;
      if (kind === 'function') { kind = 'boundary'; data = { modelId: 'wasm/function/' + module.byteHash + '/' + node.index, modelVersion: SEMANTIC_ANALYSIS_VERSIONS.wasmFlow,
        invocation, boundaryKind: node.import ? 'wasm-module-import-function' : 'wasm-module-function',
        fromContext: 'source:' + doc.item.source.sourceUnitId, toContext: 'wasm:' + module.byteHash + ':function:' + node.index }; }
      else if (kind === 'instruction') { kind = 'expression'; data = { astKind: 'WasmInstruction', operation: node.name,
        invocationKind: [16, 17].includes(node.opcode) ? 'call' : null, syntacticArgumentCount: null,
        flags: ['binary-offset-in-evidence', 'function-index:' + node.functionIndex, 'byte-offset:' + node.offset] }; }
      else if (kind === 'value') data = { origin: node.origin, site: ref(node.site), storage: null };
      else data = { owner: ref(node.owner), blockKind: node.blockKind };
      ledger.rows.push({ family: 'node', row: { id: ref(node.id).localId, kind, span: null, scope: null, data } });
    }
    ledger.nextId += graph.nodes.length + 1;
    ledger.rows.push({ family: 'node', row: { id: evidence.localId, kind: 'evidence', span: null, scope: null,
      data: { method: 'bounded-wasm-binary-stack-control-flow', producerId: 'semantic-wasm', producerVersion: SEMANTIC_ANALYSIS_VERSIONS.wasmFlow,
        evidenceKind: 'static-analysis', sourceRef: doc.item.source.sourceUnitId, artifactRef } } });
    const emit = (kind, from, to, callSite = invocation, ordinal = null, certainty = 'modeled', condition = null) => {
      if (from && to) ledger.edges.push({ kind, from, to, callSite, operandOrdinal: ordinal, contextKey: group.context.contextKey, condition, evidence, certainty });
    };
    for (const item of graph.edges) {
      emit(item.kind, ref(item.from), ref(item.to), item.callSite == null ? null : ref(item.callSite), item.ordinal ?? null,
        item.kind === 'callTarget' ? 'exact-static' : 'modeled', item.condition == null ? null : ref(item.condition));
      if (item.kind === 'consumes' && graph.nodes[item.to].kind === 'instruction') ledger.rows.push({ family: 'operand', row: {
        parent: ref(item.to), slot: item.slot || 'argument', ordinal: item.ordinal, child: ref(item.from), flags: []
      } });
    }
    for (const reason of graph.reasons) ledger.reasons.add(reason);
    const result = { graph, ref, emit, module, invocation }; projections.set(handle.creation, result);
    ledger.reasons.add('wasm_static_module_instance_candidate_no_runtime_execution_claim');
    return result;
  };
  const propertyName = (ts, name) => name && (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) ? name.text : null;
  // Require entirely static own data properties: duplicate keys, spread, accessors
  // and __proto__ make the namespace unsuitable for an exact import-name join.
  const properties = (doc, input) => {
    if (!input || !doc.ts.isObjectLiteralExpression(input)) return null;
    const result = new Map();
    for (const property of input.properties) {
      const key = propertyName(doc.ts, property.name);
      if (key == null || key === '__proto__' || result.has(key) || !doc.ts.isPropertyAssignment(property) && !doc.ts.isShorthandPropertyAssignment(property)) return null;
      result.set(key, doc.ts.isPropertyAssignment(property) ? property.initializer : property.name);
    }
    return result;
  };
  const imports = (doc, handle, projected) => {
    const ledger = ledgers.get(doc), outer = properties(doc, handle.imports);
    for (const fn of projected.graph.functions) {
      const imported = projected.graph.nodes[fn.ref].import; if (!imported) continue;
      const inner = outer && properties(doc, outer.get(imported.module)), input = inner?.get(imported.name);
      const handler = input && handlerFor(doc, input);
      if (!handler || handler.doc.ts.isFunctionDeclaration(handler.node) || handler.doc !== doc && !crossEnabled(doc)) { ledger.reasons.add('wasm_import_exact_host_target_unresolved'); continue; }
      projected.emit('callTarget', projected.ref(fn.ref), handler.ref, projected.invocation, null, 'exact-static');
      if (handler.node.parameters.length < fn.params.length || handler.node.parameters.some(param => param.dotDotDotToken || param.initializer || !handler.doc.ts.isIdentifier(param.name))) {
        ledger.reasons.add('wasm_import_host_parameter_mapping_unresolved'); continue;
      }
      fn.params.forEach((parameter, ordinal) => {
        const symbol = handler.doc.checker.getSymbolAtLocation(handler.node.parameters[ordinal].name);
        for (const use of ledgers.get(handler.doc).uses.get(symbol) || []) if (use.node.pos >= handler.node.pos && use.node.end <= handler.node.end) projected.emit('argumentToParameter', projected.ref(parameter), use.ref, projected.invocation, ordinal);
      });
      const ts = handler.doc.ts, body = handler.node.body;
      const asynchronous = handler.node.asteriskToken || handler.node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword);
      const returned = !asynchronous && body && (!ts.isBlock(body) ? body
        : body.statements.length === 1 && ts.isReturnStatement(body.statements[0]) ? body.statements[0].expression : null);
      if (returned && fn.results.length === 1) projected.emit('returnToResult', handler.doc.expressionFor(returned), projected.ref(fn.results[0]), projected.invocation, 0);
      else if (fn.results.length) ledger.reasons.add('wasm_host_return_completion_or_multivalue_unresolved');
      ledger.reasons.add('wasm_host_return_conversion_and_traps_unresolved');
    }
    if (projected.module.imports.some(item => item.kind !== 0)) ledger.reasons.add('wasm_nonfunction_import_storage_identity_unresolved');
  };
  return {
    async collect({ doc, node, request, wasmExport }) {
      throwIfAborted(signal);
      const ledger = ledgers.get(doc), ts = doc.ts;
      if (!wasmExport) {
        const handle = await resolve(doc, node); if (!handle) return false;
        const projected = await project(doc, handle); if (!projected) return true;
        if (!['module', 'promise-module'].includes(handle.kind)) {
          imports(doc, handle, projected);
          if (projected.module.start != null) projected.emit('dispatches', request, projected.ref(projected.graph.functions[projected.module.start].ref));
        }
        return true;
      }
      const access = node.expression, receiver = access.expression;
      const name = ts.isPropertyAccessExpression(access) ? access.name.text : ts.isStringLiteral(access.argumentExpression) ? access.argumentExpression.text : null;
      if (name == null || !ts.isPropertyAccessExpression(receiver) || receiver.name.text !== 'exports') { ledger.reasons.add('wasm_export_name_or_receiver_dynamic'); return false; }
      const handle = await resolve(doc, receiver.expression);
      if (handle?.kind !== 'instance') { ledger.reasons.add('wasm_export_instance_provenance_unresolved'); return false; }
      const projected = await project(doc, handle); if (!projected) return true;
      const target = projected.module.exports.find(item => item.name === name && item.kind === 0);
      if (!target) { ledger.reasons.add('wasm_export_function_name_missing'); return true; }
      const fn = projected.graph.functions[target.index], callSite = doc.expressionFor(node);
      projected.emit('callTarget', request, projected.ref(fn.ref), callSite, null, 'exact-static');
      const args = node.arguments || [];
      if (args.some(arg => ts.isSpreadElement(arg))) ledger.reasons.add('wasm_export_spread_parameter_positions_unresolved');
      else fn.params.forEach((parameter, ordinal) => {
        const argument = doc.expressionFor(args[ordinal]);
        if (argument) projected.emit('argumentToParameter', argument, projected.ref(parameter), callSite, ordinal);
        else ledger.reasons.add('wasm_export_missing_argument_conversion_unresolved');
      });
      // WebAssembly JS API packs multi-value results into an array; don't identify
      // the scalar channels with that array's identity.
      if (fn.results.length === 1) projected.emit('returnToResult', projected.ref(fn.results[0]), callSite, callSite);
      else if (fn.results.length > 1) { fn.results.forEach((result, ordinal) => projected.emit('packs', projected.ref(result), callSite, callSite, ordinal)); ledger.reasons.add('wasm_multivalue_host_array_identity_unresolved'); }
      ledger.reasons.add('wasm_host_numeric_conversion_traps_and_activation_unobserved');
      return true;
    }
  };
};
