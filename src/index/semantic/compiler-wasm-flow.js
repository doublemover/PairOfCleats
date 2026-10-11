import { compilerRuntimeParameters } from './compiler-invocation.js';
import { createWasmHostBytes } from './wasm/host-bytes.js';
import { decodeWasmModule } from './wasm/decode.js';
import { projectWasmModule } from './wasm/project.js';
import { throwIfAborted } from '../../shared/abort.js';

const library = (value, name) => value?.family === 'typescript-default-library' && value.names.includes(name);
/** Narrow immutable-byte provenance. No unretained filesystem reads, arbitrary URLs, evaluation
 * or mutable typed-array aliases. The existing boundary owner supplies authority,
 * record allocation, callback resolution, publication and disk accounting.
 */
export const createCompilerWasmFlow = ({ group, state, authority, ledgers, handlerFor, crossEnabled, signal }) => {
  const resolutions = new WeakMap(), projections = new WeakMap();
  const refKey = ref => ref && ref.partitionId + ':' + ref.localId;
  const completions = new Map();
  for (const document of group.flowDocuments || []) for (const summary of document.summaries) completions.set(refKey(summary.ownerRef), { summary, edges: document.flowEdges });
  const hostBytes = createWasmHostBytes({ group, authority, ledgers, signal });
  const safeHandleUse = (doc, node, kind, seen = new Set()) => {
    const ts = doc.ts, parent = node.parent;
    if (!parent || seen.size >= 32) return false;
    if (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isNonNullExpression(parent)) return safeHandleUse(doc, parent, kind, seen);
    if (ts.isVariableDeclaration(parent) && parent.initializer === node && parent.parent.flags & ts.NodeFlags.Const) {
      const symbol = doc.checker.getSymbolAtLocation(parent.name);
      if (!symbol || seen.has(symbol)) return false;
      return (ledgers.get(doc).uses.get(symbol) || []).every(use => use.node === parent.name || safeHandleUse(doc, use.node, kind, new Set(seen).add(symbol)));
    }
    // Promise callbacks can expose the same settled instance or mutable result to
    // unobserved writes. Only await and immutable aliases preserve provenance.
    if (kind.startsWith('promise-')) return ts.isAwaitExpression(parent)
      && safeHandleUse(doc, parent, kind.slice(8), seen);
    if (kind === 'instantiated') return ts.isPropertyAccessExpression(parent)
      && parent.expression === node && parent.name.text === 'instance'
      && safeHandleUse(doc, parent, 'instance', seen);
    // Instance.exports is inherited and can be shadowed on an escaped instance,
    // even though the native exports object itself is frozen.
    if (!ts.isPropertyAccessExpression(parent) || parent.expression !== node || parent.name.text !== 'exports') return false;
    const outer = parent.parent;
    return !(ts.isBinaryExpression(outer) && outer.left === parent && outer.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && outer.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      || ts.isDeleteExpression(outer) || ts.isPrefixUnaryExpression(outer) || ts.isPostfixUnaryExpression(outer));
  };
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
      // A const binding alone cannot authorize mutable results or instances after
      // writes/escape, including access through the promise's settled value.
      const guardedKinds = ['instance', 'instantiated', 'promise-instance', 'promise-instantiated'];
      if (guardedKinds.includes(result?.kind) && (ledger.uses.get(symbol) || []).some(use => use.node !== declaration.name && !safeHandleUse(doc, use.node, result.kind, new Set([symbol])))) {
        const reason = result.kind.startsWith('promise-') ? 'wasm_instantiation_promise_mutation_or_escape'
          : result.kind === 'instantiated' ? 'wasm_instantiation_result_mutation_or_escape' : 'wasm_instance_mutation_or_escape';
        ledger.reasons.add(reason); return null;
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
    const streaming = names.includes('compileStreaming') || names.includes('instantiateStreaming');
    const compile = !constructor && (names.includes('compile') || names.includes('compileStreaming')), instantiate = !constructor && (names.includes('instantiate') || names.includes('instantiateStreaming'));
    if (!isModule && !isInstance && !compile && !instantiate) return null;
    let moduleHandle = await resolve(doc, args[0], seen);
    if (streaming || (!isInstance && !instantiate) || moduleHandle?.kind !== 'module') moduleHandle = null;
    if (!moduleHandle && !isInstance) {
      const recovered = await hostBytes.read(doc, args[0]);
      if (recovered && (streaming ? ['response', 'promise-response'].includes(recovered.kind) : ['bytes', 'buffer'].includes(recovered.kind))) {
        const decoded = decodeWasmModule(recovered.bytes, { signal });
        if (decoded.status === 'decoded') moduleHandle = { ...recovered, kind: 'module', decoded: decoded.module };
        else ledger.reasons.add(decoded.reason);
      }
    }
    if (!moduleHandle) { ledger.reasons.add('wasm_exact_module_bytes_unavailable'); resolutions.set(input, null); return null; }
    const result = { ...moduleHandle, creation: input, imports: args[1] || null, authority: verified,
      kind: isModule ? 'module' : compile ? 'promise-module' : isInstance ? 'instance' : (await resolve(doc, args[0], seen))?.kind === 'module' ? 'promise-instance' : 'promise-instantiated' };
    resolutions.set(input, result); return result;
  };
  const project = async (doc, handle) => {
    if (projections.has(handle.creation)) return projections.get(handle.creation);
    const result = await projectWasmModule({ ledger: ledgers.get(doc), module: handle.decoded, bytes: handle.bytes,
      invocation: doc.expressionFor(handle.creation), byteExpression: handle.byteExpression, source: doc.item.source,
      stagingRoot: doc.item.root, binarySource: handle.source || null, state, contextKey: group.context.contextKey, signal });
    if (result) { projections.set(handle.creation, result); if (handle.moduleRef) result.emit('evidenceInput', handle.moduleRef, result.invocation); }
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
  const imports = async (doc, handle, projected) => {
    const ledger = ledgers.get(doc), outer = properties(doc, handle.imports);
    for (const fn of projected.graph.functions) {
      const imported = projected.graph.nodes[fn.ref].import; if (!imported) continue;
      const inner = outer && properties(doc, outer.get(imported.module)), input = inner?.get(imported.name);
      const handler = input && handlerFor(doc, input);
      if (!handler || handler.doc !== doc && !crossEnabled(doc)) { ledger.reasons.add('wasm_import_exact_host_target_unresolved'); continue; }
      if (handler.doc.ts.isFunctionDeclaration(handler.node)) {
        const symbol=handler.doc.checker.getSymbolAtLocation(handler.node.name), ts=handler.doc.ts;
        const writesBinding = use => {
          let current = use.node, parent = current.parent;
          while (parent && (ts.isArrayLiteralExpression(parent) || ts.isObjectLiteralExpression(parent) || ts.isSpreadElement(parent) || ts.isShorthandPropertyAssignment(parent) || ts.isPropertyAssignment(parent) || ts.isParenthesizedExpression(parent))) { current = parent; parent = parent.parent; }
          return parent && (ts.isBinaryExpression(parent) && parent.left === current && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
            || (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(parent.operator)
            || (ts.isForOfStatement(parent) || ts.isForInStatement(parent)) && parent.initializer === current);
        };
        if ((ledgers.get(handler.doc).uses.get(symbol)||[]).some(writesBinding)) {
          ledger.reasons.add('wasm_import_host_callable_reassigned'); continue;
        }
      }
      projected.emit('callTarget', projected.ref(fn.ref), handler.ref, projected.invocation, null, handle.certainty || 'exact-static');
      const ts = handler.doc.ts, body = handler.node.body;
      const asynchronous = handler.node.asteriskToken || handler.node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword);
      if (asynchronous) { ledger.reasons.add('wasm_async_or_generator_host_result_not_awaited'); continue; }
      fn.params.forEach((parameter, ordinal) => {
        const parameters=compilerRuntimeParameters(ts, handler.node), rest=parameters.findIndex(param=>param.dotDotDotToken);
        const target=parameters[rest>=0&&ordinal>=rest?rest:ordinal];
        if(!target||!ts.isIdentifier(target.name)) { ledger.reasons.add('wasm_import_host_parameter_mapping_unresolved'); return; }
        if(target.initializer)ledger.reasons.add('wasm_host_default_parameter_conversion_branch_unresolved');
        const symbol = handler.doc.checker.getSymbolAtLocation(target.name);
        for (const use of ledgers.get(handler.doc).uses.get(symbol) || []) if (use.node.pos >= handler.node.pos && use.node.end <= handler.node.end) projected.emit(target.dotDotDotToken?'packs':'argumentToParameter', projected.ref(parameter), use.ref, projected.invocation, ordinal);
      });
      const completion=completions.get(refKey(handler.ref));
      const simple = body && (!ts.isBlock(body) ? body : body.statements.length === 1 && ts.isReturnStatement(body.statements[0]) ? body.statements[0].expression : null);
      const returns=completion ? completion.summary.returns.map(ref=>({ref,node:null})) : simple?[{ref:handler.doc.expressionFor(simple),node:simple}]:[];
      for(const returned of returns) {
        if(fn.results.length===1) projected.emit('returnToResult',returned.ref,projected.ref(fn.results[0]),projected.invocation,0);
        else if(fn.results.length>1) {
          let expression=returned.node;
          if(!expression) {
            const origin=completion.edges.find(edge=>edge.kind==='returns'&&refKey(edge.to)===refKey(returned.ref))?.from;
            expression=origin&&handler.doc.nodes.find(node=>refKey(handler.doc.expressionFor(node))===refKey(origin));
          }
          if(expression&&ts.isArrayLiteralExpression(expression)&&expression.elements.length===fn.results.length&&!expression.elements.some(element=>ts.isSpreadElement(element)||ts.isOmittedExpression(element))) {
            fn.results.forEach((result,ordinal)=>projected.emit('returnToResult',handler.doc.expressionFor(expression.elements[ordinal]),projected.ref(result),projected.invocation,ordinal));
          } else ledger.reasons.add('wasm_host_multivalue_iterable_unresolved');
        }
      }
      if(completion) {
        for(const exception of completion.summary.exceptions) projected.emit('throws',exception,projected.ref(fn.thrown),projected.invocation);
        if(!completion.summary.complete)ledger.reasons.add('wasm_host_completion_summary_partial');
      } else if(!simple && fn.results.length)ledger.reasons.add('wasm_host_return_completion_unavailable');
      ledger.reasons.add('wasm_host_return_conversion_and_traps_unresolved');
    }
    const indexes = {1:0,2:0,3:0,4:0};
    for (const imported of projected.module.imports) if ([1,2,3,4].includes(imported.kind)) {
      const kind={1:'table',2:'memory',3:'global',4:'tag'}[imported.kind], index=indexes[imported.kind]++;
      const value=outer&&properties(doc,outer.get(imported.module))?.get(imported.name);
      const storage=projected.ref(projected.graph.storages[kind][index]);
      const verified=value&&await authority.type(doc,value,[{1:'Table',2:'Memory',3:'Global',4:'Tag'}[imported.kind]]);
      if(verified?.length&&verified.every(value=>library(value,'WebAssembly'))) {
        projected.emit(kind === 'tag' ? 'aliases' : 'sharesStorage',doc.expressionFor(value),storage); projected.emit(kind === 'tag' ? 'aliases' : 'sharesStorage',storage,doc.expressionFor(value));
      } else if(imported.kind===3&&value)projected.emit('defines',doc.expressionFor(value),storage);
      else ledger.reasons.add('wasm_nonfunction_import_storage_identity_unresolved');
    }
  };
  return {
    async collectMember(doc,node) {
      const ts=doc.ts;
      if(!ts.isPropertyAccessExpression(node)&&!ts.isElementAccessExpression(node))return;
      const receiver=node.expression;
      if(!ts.isPropertyAccessExpression(receiver)||receiver.name.text!=='exports')return;
      const name=ts.isPropertyAccessExpression(node)?node.name.text:ts.isStringLiteral(node.argumentExpression)?node.argumentExpression.text:null;
      const handle=await resolve(doc,receiver.expression); if(handle?.kind!=='instance'||name==null)return;
      const target=handle.decoded.exports.find(item=>item.name===name&&[1,2,3,4].includes(item.kind)); if(!target)return;
      const projected=await project(doc,handle); if(!projected)return;
      const storage=projected.ref(projected.graph.storages[{1:'table',2:'memory',3:'global',4:'tag'}[target.kind]][target.index]);
      projected.emit(target.kind === 4 ? 'aliases' : 'sharesStorage',storage,doc.expressionFor(node)); projected.emit(target.kind === 4 ? 'aliases' : 'sharesStorage',doc.expressionFor(node),storage);
    },
    async collect({ doc, node, request, wasmExport }) {
      throwIfAborted(signal);
      const ledger = ledgers.get(doc), ts = doc.ts;
      if (!wasmExport) {
        const handle = await resolve(doc, node); if (!handle) return false;
        const projected = await project(doc, handle); if (!projected) return true;
        if (!['module', 'promise-module'].includes(handle.kind)) {
          await imports(doc, handle, projected);
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
      projected.emit('callTarget', request, projected.ref(fn.ref), callSite, null, handle.certainty || 'exact-static');
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
      projected.emit('throws',projected.ref(fn.exception),callSite,callSite);
      ledger.reasons.add('wasm_host_numeric_conversion_traps_and_activation_unobserved');
      return true;
    }
  };
};
