import { throwIfAborted } from '../../shared/abort.js';

/** Bounded, source-backed endpoint candidates; no delivery or detachment claims.
 * HTML MessagePort post-message steps filter transferred values to MessagePorts,
 * preserving relative order: https://html.spec.whatwg.org/multipage/web-messaging.html#message-ports
 */
export const createBrowserPortFlow = ({ documents, ledgers, platformType, signal }) => {
  const received = new Map(documents.map(doc => [doc, new Map()]));
  let work = 100000;
  const budget = doc => {
    throwIfAborted(signal);
    if (--work >= 0) return true;
    ledgers.get(doc).reasons.add('browser_port_join_work_budget');
    return false;
  };
  const same = (a, b) => a.channel === b.channel && a.port === b.port;
  const candidates = value => value?.ports || (value?.port ? [value] : []);
  const read = (doc, input) => {
    const { ts, checker } = doc, parts = [];
    let node = input;
    while (node && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) {
      const key = ts.isPropertyAccessExpression(node) ? node.name : node.argumentExpression;
      if (!key || !(ts.isIdentifier(key) && ts.isPropertyAccessExpression(node) || ts.isStringLiteralLike(key) || ts.isNumericLiteral(key)) || parts.length >= 10) return null;
      parts.unshift(key.text); node = node.expression;
    }
    if (!node || !ts.isIdentifier(node)) return null;
    const ports = received.get(doc).get(checker.getSymbolAtLocation(node))?.get(JSON.stringify(parts));
    return ports?.length ? { ports } : null;
  };
  const bind = (doc, root, parts, ports) => {
    if (!budget(doc)) return false;
    if (!received.get(doc).has(root)) received.get(doc).set(root, new Map());
    const paths = received.get(doc).get(root), key = JSON.stringify(parts), old = paths.get(key) || [];
    let changed = false;
    for (const port of ports) if (!old.some(value => same(value, port))) {
      if (old.length >= 32) { ledgers.get(doc).reasons.add('browser_port_candidate_budget'); break; }
      old.push(port); changed = true;
    }
    paths.set(key, old); return changed;
  };
  const properties = (doc, node) => {
    if (!node || !doc.ts.isObjectLiteralExpression(node)) return null;
    const result = new Map();
    for (const property of node.properties) {
      if (!budget(doc)) return null;
      if (!doc.ts.isPropertyAssignment(property) && !doc.ts.isShorthandPropertyAssignment(property)) return null;
      const key = property.name;
      if (!(doc.ts.isIdentifier(key) || doc.ts.isStringLiteralLike(key) || doc.ts.isNumericLiteral(key)) || result.has(key.text) || key.text === '__proto__') return null;
      result.set(key.text, doc.ts.isPropertyAssignment(property) ? property.initializer : property.name);
    }
    return result;
  };
  const transferred = (doc, call, resolvePort) => {
    const { ts } = doc;
    let list = call.arguments[1];
    if (list && ts.isObjectLiteralExpression(list)) list = properties(doc, list)?.get('transfer');
    if (!list) return [];
    if (!ts.isArrayLiteralExpression(list) || list.elements.length > 32 || list.elements.some(value => ts.isSpreadElement(value) || ts.isOmittedExpression(value))) {
      ledgers.get(doc).reasons.add('browser_port_transfer_list_dynamic_or_budget'); return [];
    }
    const result = [], allowed = [];
    let ordinal = 0, ordered = true;
    for (const value of list.elements) {
      const ports = candidates(resolvePort(doc, value));
      if (ports.length) {
        if (ports.some(port => allowed.some(old => same(old, port)))) { ledgers.get(doc).reasons.add('browser_port_duplicate_transfer_unresolved'); return []; }
        allowed.push(...ports);
        if (ordered) result.push({ parts: ['ports', String(ordinal)], ports });
        ordinal++;
      } else if (platformType(doc, value, ['MessagePort'])) ordinal++;
      else if (!platformType(doc, value, ['ArrayBuffer', 'OffscreenCanvas', 'ImageBitmap', 'ReadableStream', 'WritableStream', 'TransformStream'])) {
        // An unknown transfer could be a port and shifts all subsequent indices.
        ordered = false; ledgers.get(doc).reasons.add('browser_port_transfer_order_unresolved');
      }
    }
    const pending = [{ node: call.arguments[0], parts: ['data'], seen: new Set() }];
    while (pending.length && budget(doc)) {
      const item = pending.pop(), node = item.node;
      if (!node) continue;
      if (item.parts.length > 9 || item.seen.size >= 32 || item.seen.has(node)) { ledgers.get(doc).reasons.add('browser_port_payload_depth_or_alias_budget'); continue; }
      const seen = new Set(item.seen).add(node), ports = candidates(resolvePort(doc, node)).filter(port => allowed.some(value => same(value, port)));
      if (ports.length) { result.push({ parts: item.parts, ports }); continue; }
      if (ts.isIdentifier(node)) {
        const declaration = doc.checker.getSymbolAtLocation(node)?.valueDeclaration;
        if (declaration && ts.isVariableDeclaration(declaration) && declaration.getSourceFile() === doc.sourceFile && declaration.parent.flags & ts.NodeFlags.Const) pending.push({ ...item, node: declaration.initializer, seen });
      } else if (ts.isObjectLiteralExpression(node)) {
        const props = properties(doc, node);
        if (!props) { ledgers.get(doc).reasons.add('browser_port_payload_shape_unresolved'); continue; }
        for (const [key, value] of props) {
          if (!budget(doc)) break;
          pending.push({ node: value, parts: [...item.parts, key], seen });
        }
      } else if (ts.isArrayLiteralExpression(node)) {
        const children = [];
        let valid = true;
        for (let index = 0; index < node.elements.length; index++) {
          if (!budget(doc)) { valid = false; break; }
          const value = node.elements[index];
          if (ts.isSpreadElement(value) || ts.isOmittedExpression(value)) {
            ledgers.get(doc).reasons.add('browser_port_payload_shape_unresolved'); valid = false; break;
          }
          children.push({ node: value, parts: [...item.parts, String(index)], seen });
        }
        if (valid) for (const child of children) pending.push(child);
      }
    }
    return result;
  };
  return { read, candidates, same, budget, transferred, bind };
};
