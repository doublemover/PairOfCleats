import path from 'node:path';
import { WASM_LIMITS } from './decode.js';
import { throwIfAborted } from '../../../shared/abort.js';
const library = (value, name) => value?.family === 'typescript-default-library' && value.names.includes(name);
const memberName = (ts, call) => ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : null;
const keyPath = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
export const createWasmHostBytes = ({ group, authority, ledgers, signal }) => {
  const signature = (doc, node) => authority.declaration(doc.checker.getResolvedSignature(node)?.declaration);
  const literal = (ts, node) => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
  const safeUses = async (doc, symbol, declaration, seen, kind) => {
    const ts = doc.ts;
    for (const use of ledgers.get(doc).uses.get(symbol) || []) {
      if (use.node === declaration.name) continue;
      let parent = use.node.parent;
      if (ts.isVariableDeclaration(parent) && parent.initializer === use.node && parent.parent.flags & ts.NodeFlags.Const) {
        const alias = doc.checker.getSymbolAtLocation(parent.name);
        if (!alias || seen.has(alias) || seen.size > 32 || !await safeUses(doc, alias, parent, new Set(seen).add(alias), kind)) return false;
        continue;
      }
      if (ts.isSpreadElement(parent) && ts.isArrayLiteralExpression(parent.parent)) continue;
      if (ts.isPropertyAccessExpression(parent) && parent.expression === use.node) {
        if (parent.name.text === 'length' || parent.name.text === 'byteLength') {
          const outer = parent.parent;
          if (ts.isBinaryExpression(outer) && outer.left === parent || ts.isPostfixUnaryExpression(outer) || ts.isPrefixUnaryExpression(outer)) return false;
          continue;
        }
        if (!['slice', 'subarray', 'arrayBuffer'].includes(parent.name.text) || !ts.isCallExpression(parent.parent)) return false;
        parent = parent.parent;
        if (memberName(ts, parent) === 'subarray') {
          const consumer = parent.parent;
          if ((!ts.isCallExpression(consumer) && !ts.isNewExpression(consumer)) || !library(await signature(doc, consumer), 'WebAssembly')) return false;
        }
      }
      if (!ts.isCallExpression(parent) && !ts.isNewExpression(parent)) return false;
      const verified = await signature(doc, parent);
      // A typed-array constructor copies a typed array, but aliases an ArrayBuffer.
      // Follow the resulting view before treating any use of that buffer as immutable.
      if (kind === 'buffer' && ts.isNewExpression(parent) && library(verified, 'Uint8ArrayConstructor')) {
        const consumer = parent.parent;
        if (ts.isVariableDeclaration(consumer) && consumer.initializer === parent && consumer.parent.flags & ts.NodeFlags.Const) {
          const alias = doc.checker.getSymbolAtLocation(consumer.name);
          if (!alias || seen.has(alias) || seen.size >= 32 || !await safeUses(doc, alias, consumer, new Set(seen).add(alias), 'bytes')) return false;
        } else if ((!ts.isCallExpression(consumer) && !ts.isNewExpression(consumer)) || !library(await signature(doc, consumer), 'WebAssembly')) return false;
      }
      if (!library(verified, 'WebAssembly') && !library(verified, 'Uint8ArrayConstructor') && !library(verified, 'Uint8Array') && !library(verified, 'Response') && !library(verified, 'Body')) return false;
    }
    return true;
  };
  const read = async (doc, input, seen = new Set()) => {
    throwIfAborted(signal);
    if (!input || seen.has(input) || seen.size >= 32) return null;
    const ts = doc.ts; seen = new Set(seen).add(input);
    if (ts.isParenthesizedExpression(input) || ts.isAsExpression(input) || ts.isNonNullExpression(input)) return read(doc, input.expression, seen);
    if (ts.isAwaitExpression(input)) {
      const result = await read(doc, input.expression, seen);
      return result?.kind?.startsWith('promise-') ? { ...result, kind: result.kind.slice(8) } : result;
    }
    if (ts.isIdentifier(input)) {
      const symbol = doc.checker.getSymbolAtLocation(input), declarations = symbol?.declarations || [];
      if (declarations.length !== 1) return null;
      const declaration = declarations[0];
      if (!ts.isVariableDeclaration(declaration) || declaration.getSourceFile() !== doc.sourceFile || !(declaration.parent.flags & ts.NodeFlags.Const)) return null;
      const result = await read(doc, declaration.initializer, seen);
      if (!await safeUses(doc, symbol, declaration, new Set([symbol]), result?.kind)) { ledgers.get(doc).reasons.add('wasm_byte_source_mutation_or_escape'); return null; }
      return result;
    }
    const number = node => ts.isNumericLiteral(node) ? Number(node.text) : null;
    if (ts.isArrayLiteralExpression(input)) {
      const bytes = [];
      for (const element of input.elements) {
        if (ts.isSpreadElement(element)) {
          const part = await read(doc, element.expression, seen); if (!['bytes', 'array'].includes(part?.kind)) return null;
          bytes.push(...part.bytes);
        } else { const value = number(element); if (value == null || !Number.isInteger(value) || value < 0 || value > 255) return null; bytes.push(value); }
        if (bytes.length > WASM_LIMITS.bytes) { ledgers.get(doc).reasons.add('wasm_byte_budget'); return null; }
      }
      return { kind: 'array', bytes: Buffer.from(bytes), byteExpression: doc.expressionFor(input), certainty: 'exact-static' };
    }
    if (!ts.isCallExpression(input) && !ts.isNewExpression(input)) return null;
    const verified = await signature(doc, input), args = input.arguments || [];
    if (library(verified, 'Uint8ArrayConstructor')) {
      if (ts.isNewExpression(input) && args.length === 1) {
        const result = await read(doc, args[0], seen);
        return ['array', 'bytes', 'buffer'].includes(result?.kind) ? { ...result, kind: 'bytes' } : null;
      }
      if (verified.names.includes('of') && args.length <= WASM_LIMITS.bytes && args.every(arg => number(arg) != null && Number.isInteger(number(arg)) && number(arg) >= 0 && number(arg) <= 255)) return {
        kind: 'bytes', bytes: Buffer.from(args.map(number)), byteExpression: doc.expressionFor(input), certainty: 'exact-static'
      };
    }
    if (library(verified, 'Uint8Array') && ['slice', 'subarray'].some(name => verified.names.includes(name)) && ts.isPropertyAccessExpression(input.expression)) {
      const source = await read(doc, input.expression.expression, seen);
      if (source?.kind !== 'bytes' || args.length > 2 || args.some(arg => number(arg) == null)) return null;
      return { ...source, bytes: Buffer.from(source.bytes.subarray(args[0] ? number(args[0]) : 0, args[1] ? number(args[1]) : undefined)) };
    }
    if (library(verified, 'Response') && ts.isNewExpression(input)) {
      const result = await read(doc, args[0], seen); return ['bytes', 'buffer'].includes(result?.kind) ? { ...result, kind: 'response' } : null;
    }
    if (library(verified, 'Body') && verified.names.includes('arrayBuffer') && ts.isPropertyAccessExpression(input.expression)) {
      const result = await read(doc, input.expression.expression, seen); return result?.kind === 'response' ? { ...result, kind: 'promise-buffer' } : null;
    }
    const fetch = library(verified, 'fetch') || verified?.family === 'node-type-package' && verified.library === 'web-globals/fetch.d.ts' && verified.names.includes('fetch');
    const fileRead = verified?.family === 'node-type-package' && ['fs', 'node:fs', 'fs/promises', 'node:fs/promises'].includes(verified.moduleName)
      && (verified.names.includes('readFileSync') || verified.names.includes('readFile') && verified.library.includes('promises'));
    if (!fetch && !fileRead) return null;
    const url = args[0];
    if (!url || !ts.isNewExpression(url) || !library(await signature(doc, url), 'URL')) return null;
    const [name, base] = url.arguments || [], filename = literal(ts, name);
    if (!filename?.startsWith('.') || /[?#\\%]/.test(filename) || !base || !ts.isPropertyAccessExpression(base) || base.name.text !== 'url' || !ts.isMetaProperty(base.expression) || base.expression.keywordToken !== ts.SyntaxKind.ImportKeyword) return null;
    if (fileRead && args.length !== 1) return null; // Encoding options change the returned type.
    const container = doc.containerPath || (!doc.item.source.mapping ? doc.item.source.path : null);
    const retained = container && group.wasmModules?.get(keyPath(path.resolve(group.repoRoot, path.dirname(container), filename)));
    if (!retained) { ledgers.get(doc).reasons.add('wasm_local_binary_not_in_retained_inventory'); return null; }
    const bytes = await retained.readBytes(signal); if (!bytes) { ledgers.get(doc).reasons.add('wasm_byte_budget'); return null; }
    // Mapping a source URL to the retained file is a candidate, not proof of the
    // network response, filesystem state, MIME acceptance or successful delivery.
    ledgers.get(doc).reasons.add(fetch ? 'wasm_fetch_response_mime_and_delivery_unobserved' : 'wasm_filesystem_read_runtime_contents_unobserved');
    return { kind: fetch ? 'promise-response' : verified.names.includes('readFileSync') ? 'bytes' : 'promise-bytes',
      bytes, source: retained.source, moduleRef: retained.moduleRef, certainty: 'modeled', byteExpression: doc.expressionFor(input) };
  };
  return { read };
};
