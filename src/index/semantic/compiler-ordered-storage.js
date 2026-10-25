import { canonicalSemanticJson } from './identity.js';
import { throwIfAborted } from '../../shared/abort.js';

const MAX_FIELDS = 64;
/** One document pass supplies owner-local work and cross-owner captures. */
export const indexCompilerOrderedStorage = ({ ts, checker, sourceFile, nodes, signal }) => {
  const owners = new WeakMap(), declarations = new WeakMap(), buckets = new Map(), captures = new Map();
  const nearestOwner = node => {
    if (!node) return sourceFile;
    if (owners.has(node)) return owners.get(node);
    const pending = [node]; let current = node.parent;
    while (current && !ts.isFunctionLike(current) && !owners.has(current)) { pending.push(current); current = current.parent; }
    const owner = current && ts.isFunctionLike(current) ? current : current ? owners.get(current) : sourceFile;
    for (const item of pending) owners.set(item, owner);
    return owner;
  };
  for (const node of nodes) {
    throwIfAborted(signal);
    const owner = nearestOwner(node);
    if (!buckets.has(owner)) buckets.set(owner, []);
    buckets.get(owner).push(node);
    if (!ts.isIdentifier(node)) continue;
    const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
    declarations.set(node, declaration);
    if (!declaration || !ts.isVariableDeclaration(declaration) || !(declaration.parent.flags & ts.NodeFlags.Const)) continue;
    const declaredOwner = nearestOwner(declaration);
    if (declaredOwner !== owner) {
      if (!captures.has(declaredOwner)) captures.set(declaredOwner, []);
      captures.get(declaredOwner).push(node);
    }
  }
  return { nearestOwner, declarations, buckets, captures };
};
/** Small allocation-state subset. Allocation identity is a source site plus call
 * context, never value equality. Unsupported roots continue through may-locations.
 */
export const createCompilerOrderedStorage = ({ ts, checker, isDefaultLibrary, owner, sourceFile, nodes, expressionFor,
  index = indexCompilerOrderedStorage({ ts, checker, sourceFile, nodes }), signal, reasons = new Set() }) => {
  const descriptors = new Map(), memo = new WeakMap(), resolving = new Set(), operations = new Map(), accesses = new Set();
  const { nearestOwner } = index;
  const localNodes = index.buckets.get(owner) || [];
  const unwrap = input => {
    let node = input;
    while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)
      || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression;
    return node;
  };
  const nameOf = input => {
    const node = unwrap(input);
    return node && (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) ? node.text : null;
  };
  const integer = input => {
    const node = unwrap(input);
    if (!node) return null;
    if (ts.isNumericLiteral(node) && Number.isSafeInteger(Number(node.text))) return Number(node.text);
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return -Number(node.operand.text);
    return null;
  };
  const register = (node, kind, members, extra = {}) => {
    const root = expressionFor(node);
    if (!root || members.size > MAX_FIELDS) return null;
    const descriptor = { node, root, kind, members, offset: 0, length: members.size, escapeAt: Infinity, ...extra };
    descriptors.set(canonicalSemanticJson(root), descriptor);
    return descriptor;
  };
  const intrinsic = node => {
    const declaration = checker.getResolvedSignature(node)?.declaration;
    if (!declaration || typeof isDefaultLibrary !== 'function' || !isDefaultLibrary(declaration.getSourceFile())) return null;
    return { owner: declaration.parent?.name?.text, method: declaration.name?.text };
  };
  const resolve = input => {
    const node = unwrap(input);
    if (!node || resolving.has(node)) return null;
    if (memo.has(node)) return memo.get(node);
    resolving.add(node);
    let result = null;
    if (ts.isIdentifier(node)) {
      const declaration = index.declarations.get(node);
      if (declaration && ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name)
        && (declaration.parent.flags & ts.NodeFlags.Const) && nearestOwner(declaration) === owner) result = resolve(declaration.initializer);
    } else if (ts.isObjectLiteralExpression(node) && nearestOwner(node) === owner) {
      const members = new Map();
      let supported = true;
      for (const member of node.properties) {
        const key = nameOf(member.name);
        if (key === null || key === '__proto__' || !(ts.isPropertyAssignment(member) || ts.isShorthandPropertyAssignment(member))) { supported = false; break; }
        members.set(key, ts.isPropertyAssignment(member) ? member.initializer : member.name);
      }
      if (supported) result = register(node, 'object', members);
    } else if (ts.isArrayLiteralExpression(node) && nearestOwner(node) === owner
      && !node.elements.some(element => ts.isSpreadElement(element) || ts.isOmittedExpression(element))) {
      result = register(node, 'array', new Map(node.elements.map((element, index) => [String(index), element])));
    } else if (ts.isNewExpression(node) && nearestOwner(node) === owner) {
      const authority = intrinsic(node), args = node.arguments || [];
      if (authority?.owner === 'Uint8ArrayConstructor' && args.length === 1 && ts.isArrayLiteralExpression(unwrap(args[0]))) {
        const array = unwrap(args[0]);
        if (!array.elements.some(element => ts.isSpreadElement(element) || ts.isOmittedExpression(element))) {
          result = register(node, 'uint8', new Map(array.elements.map((element, index) => [String(index), element])));
          if (result) operations.set(node, { kind: 'initialize', descriptor: result });
        }
      }
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && nearestOwner(node) === owner) {
      const authority = intrinsic(node), source = resolve(node.expression.expression), args = node.arguments || [];
      if (source?.kind === 'uint8' && authority?.owner === 'Uint8Array' && ['slice', 'subarray'].includes(authority.method) && args.length <= 2) {
        const startInput = args[0] ? integer(args[0]) : 0, endInput = args[1] ? integer(args[1]) : source.length;
        if (startInput !== null && endInput !== null) {
          const clamp = value => Math.min(source.length, Math.max(0, value < 0 ? source.length + value : value));
          const start = clamp(startInput), end = Math.max(start, clamp(endInput)), members = new Map();
          for (let index = 0; index < end - start; index += 1) members.set(String(index), null);
          if (authority.method === 'slice') result = register(node, 'uint8', members, { snapshotSource: source, snapshotStart: start });
          else result = { ...source, node, offset: source.offset + start, length: end - start, members };
          if (result) operations.set(node, { kind: authority.method === 'slice' ? 'copy' : 'view', descriptor: result, source, start });
        }
      }
    }
    resolving.delete(node); memo.set(node, result);
    return result;
  };
  for (const node of localNodes) { throwIfAborted(signal); resolve(node); }
  const location = (descriptor, name, site) => {
    if (!descriptor || name === null) return null;
    if (descriptor.kind === 'uint8') {
      if (!/^(0|[1-9][0-9]*)$/.test(name) || Number(name) >= descriptor.length) return null;
      name = String(Number(name) + descriptor.offset);
    } else if (!descriptor.members.has(name)) return null;
    const root = descriptor.root, path = [name];
    return { root, path, key: canonicalSemanticJson({ root, path }), site, parameter: null, allocation: descriptor.node,
      initializers: descriptor.snapshotSource ? [] : [expressionFor(descriptor.members.get(name))].filter(Boolean), ordered: descriptor };
  };
  const locationsFor = node => {
    if (!node || !(ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) return [];
    const argument = unwrap(node.argumentExpression);
    const descriptor = resolve(node.expression), name = ts.isPropertyAccessExpression(node) ? node.name.text
      : argument && (ts.isStringLiteralLike(argument) || ts.isNumericLiteral(argument)) ? argument.text : null;
    const value = location(descriptor, name, expressionFor(node));
    if (value) accesses.add(canonicalSemanticJson(expressionFor(node)));
    return value ? [value] : [];
  };
  const escape = (descriptor, node) => {
    if (!descriptor) return;
    const canonical = descriptors.get(canonicalSemanticJson(descriptor.root));
    const nested = nearestOwner(node);
    const at = nested === owner ? node.getStart(sourceFile) : nested.getStart(sourceFile);
    if (canonical) canonical.escapeAt = Math.min(canonical.escapeAt, at);
    descriptor.escapeAt = Math.min(descriptor.escapeAt, at);
    reasons.add('ordered_storage_alias_escape_unresolved');
  };
  // A fresh view result has the same alias obligation as a named view. Only
  // bounded local aliases, indexed uses and recognized compositions are owned;
  // putting a view into an unsupported container ends its backing-root frontier.
  const supportedUse = input => {
    let node = input;
    for (let depth = 0; depth < 32; depth++) {
      const parent = node.parent;
      if (!parent) return false;
      if ((ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent)
        || ts.isNonNullExpression(parent) || ts.isSatisfiesExpression(parent)) && parent.expression === node) {
        node = parent; continue;
      }
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)
        && (parent.name === node || parent.initializer === node) && (parent.parent.flags & ts.NodeFlags.Const)) return true;
      if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node) {
        if (ts.isDeleteExpression(parent.parent)) return false;
        return locationsFor(parent).length > 0 || ts.isPropertyAccessExpression(parent)
          && ts.isCallExpression(parent.parent) && operations.has(parent.parent);
      }
      return false;
    }
    reasons.add('ordered_storage_use_depth_budget');
    return false;
  };
  for (const node of [...localNodes, ...(index.captures.get(owner) || [])]) {
    throwIfAborted(signal);
    if (!ts.isIdentifier(node) && !operations.has(node)) continue;
    const descriptor = resolve(node); if (!descriptor) continue;
    if (nearestOwner(node) !== owner) { escape(descriptor, node); continue; }
    if (!supportedUse(node)) escape(descriptor, node);
  }
  const canonicalDescriptor = descriptor => descriptors.get(canonicalSemanticJson(descriptor.root)) || descriptor;
  const qualified = descriptor => !descriptor?.snapshotSource || descriptor.node.getStart(sourceFile) < canonicalDescriptor(descriptor.snapshotSource).escapeAt;
  const unsupportedControl = localNodes.some(node => ts.isTryStatement(node)
    || ts.isWhileStatement(node) || ts.isDoStatement(node) || ts.isForStatement(node) || ts.isForOfStatement(node)
    || ts.isForInStatement(node) || ts.isAwaitExpression(node) || ts.isYieldExpression(node));
  return { descriptors, operations, accesses, resolve, locationsFor,
    allLocations: () => [...descriptors.values()].filter(qualified).flatMap(descriptor => [...descriptor.members.keys()].map(name => location(descriptor, name, descriptor.root)).filter(Boolean)),
    strongAt: (value, node) => Boolean(!unsupportedControl && value?.ordered && qualified(value.ordered)
      && node.getStart(sourceFile) < canonicalDescriptor(value.ordered).escapeAt),
    operationFor: node => {
      const operation = operations.get(node);
      return operation && !unsupportedControl && qualified(operation.descriptor)
        && (!operation.source || node.getStart(sourceFile) < canonicalDescriptor(operation.source).escapeAt) ? operation : null;
    },
    aggregateFieldsFor: node => {
      const descriptor = resolve(node);
      if (unsupportedControl || descriptor?.kind !== 'uint8' || !qualified(descriptor)
        || node.getStart(sourceFile) > canonicalDescriptor(descriptor).escapeAt) return [];
      return Array.from({ length: descriptor.length }, (_, index) => location(descriptor, String(index), expressionFor(node))).filter(Boolean);
    },
    fieldFor: (descriptor, index, site) => location(descriptor, String(index), site) };
};
