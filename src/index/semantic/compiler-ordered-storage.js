import { canonicalSemanticJson } from './identity.js';

const MAX_FIELDS = 64;
/** Small allocation-state subset. Allocation identity is a source site plus call
 * context, never value equality. Unsupported roots continue through may-locations.
 */
export const createCompilerOrderedStorage = ({ ts, checker, isDefaultLibrary, owner, sourceFile, nodes, expressionFor }) => {
  const descriptors = new Map(), memo = new WeakMap(), resolving = new Set(), operations = new Map(), accesses = new Set();
  const nearestOwner = node => {
    for (let current = node?.parent; current; current = current.parent) if (ts.isFunctionLike(current)) return current;
    return sourceFile;
  };
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
      const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
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
  for (const node of nodes) if (nearestOwner(node) === owner) resolve(node);
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
  };
  for (const node of nodes) {
    if (!ts.isIdentifier(node)) continue;
    const descriptor = resolve(node); if (!descriptor) continue;
    const parent = node.parent;
    if (ts.isVariableDeclaration(parent) && (parent.name === node || parent.initializer === node) && (parent.parent.flags & ts.NodeFlags.Const)) continue;
    if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node) {
      if (ts.isDeleteExpression(parent.parent)) { escape(descriptor, parent.parent); continue; }
      if (locationsFor(parent).length) continue;
      if (ts.isPropertyAccessExpression(parent) && ts.isCallExpression(parent.parent) && operations.has(parent.parent)) continue;
    }
    escape(descriptor, node);
  }
  const canonicalDescriptor = descriptor => descriptors.get(canonicalSemanticJson(descriptor.root)) || descriptor;
  const qualified = descriptor => !descriptor?.snapshotSource || descriptor.node.getStart(sourceFile) < canonicalDescriptor(descriptor.snapshotSource).escapeAt;
  const unsupportedControl = nodes.some(node => nearestOwner(node) === owner && (ts.isTryStatement(node)
    || ts.isWhileStatement(node) || ts.isDoStatement(node) || ts.isForStatement(node) || ts.isForOfStatement(node)
    || ts.isForInStatement(node) || ts.isAwaitExpression(node) || ts.isYieldExpression(node)));
  return { descriptors, operations, accesses, resolve, locationsFor,
    allLocations: () => [...descriptors.values()].filter(qualified).flatMap(descriptor => [...descriptor.members.keys()].map(name => location(descriptor, name, descriptor.root)).filter(Boolean)),
    strongAt: (value, node) => Boolean(!unsupportedControl && value?.ordered && qualified(value.ordered)
      && node.getStart(sourceFile) < canonicalDescriptor(value.ordered).escapeAt),
    operationFor: node => {
      const operation = operations.get(node);
      return operation && !unsupportedControl && qualified(operation.descriptor)
        && (!operation.source || node.getStart(sourceFile) < canonicalDescriptor(operation.source).escapeAt) ? operation : null;
    },
    fieldFor: (descriptor, index, site) => location(descriptor, String(index), site) };
};
