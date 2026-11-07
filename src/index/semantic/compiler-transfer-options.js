const ABSENT = Object.freeze({ state: 'absent', reason: 'transfer_absent', witnesses: Object.freeze([]) });
const unresolved = reason => Object.freeze({ state: 'unresolved', reason, witnesses: Object.freeze([]) });

/** A projection belongs to one immutable compiler-source collection. It only
 * inspects syntax; no getter, spread expression or indexed user code executes.
 * @returns {{properties:(doc:object,node:object)=>object,transfer:(doc:object,node:object)=>object,getMetrics:()=>object}}
 */
export const createCompilerTransferProjection = ({ budget = () => true } = {}) => {
  const documents = new WeakMap();
  const counts = { propertyObjects: 0, properties: 0, transferArguments: 0, transferElements: 0, cacheHits: 0 };
  const cacheFor = doc => {
    if (!documents.has(doc)) documents.set(doc, { properties: new WeakMap(), transfers: new WeakMap() });
    return documents.get(doc);
  };
  const properties = (doc, node) => {
    if (!node || !doc.ts.isObjectLiteralExpression(node)) return unresolved('options_not_literal');
    const cache = cacheFor(doc).properties;
    if (cache.has(node)) { counts.cacheHits++; return cache.get(node); }
    counts.propertyObjects++;
    const inspect = () => {
      if (node.properties.length > 128) return unresolved('property_budget');
      const fields = new Map(), witnesses = new Map(), { ts } = doc;
      for (const property of node.properties) {
        if (!budget(doc)) return unresolved('work_budget');
        counts.properties++;
        if (ts.isSpreadAssignment(property)) return unresolved('options_spread');
        if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return unresolved('accessor_or_method');
        const name = property.name;
        if (!ts.isIdentifier(name) && !ts.isStringLiteralLike(name) && !ts.isNumericLiteral(name)) return unresolved('computed_key');
        if (name.text === '__proto__') return unresolved('prototype_property');
        if (fields.has(name.text)) return unresolved('duplicate_property');
        fields.set(name.text, ts.isPropertyAssignment(property) ? property.initializer : property.name);
        witnesses.set(name.text, property);
      }
      const entries = Object.freeze([...fields].map(entry => Object.freeze(entry)));
      // Mutable Maps stay private; consumers receive only source-owned nodes
      // and immutable syntax witnesses, never a mutable cached authority map.
      return Object.freeze({ state: 'supported', entries,
        get: key => fields.get(key), witness: key => witnesses.get(key) });
    };
    const result = inspect(); cache.set(node, result); return result;
  };
  /** Exact supported list, known absence, or explicit unresolved syntax. The
   * list is still subject to endpoint/kind/duplicate/order qualification; this
   * does not prove cloning, detachment, activation or message delivery.
   */
  const transfer = (doc, argument) => {
    if (!argument) return ABSENT;
    const cache = cacheFor(doc).transfers;
    if (cache.has(argument)) { counts.cacheHits++; return cache.get(argument); }
    counts.transferArguments++;
    const inspect = () => {
      const { ts } = doc;
      let list = argument, property = null;
      if (ts.isObjectLiteralExpression(argument)) {
        const result = properties(doc, argument);
        if (result.state !== 'supported') return result;
        list = result.get('transfer'); property = result.witness('transfer');
        if (!list) return ABSENT;
      }
      if (!ts.isArrayLiteralExpression(list)) return unresolved('transfer_not_literal_array');
      if (list.elements.length > 32) return unresolved('list_budget');
      for (const element of list.elements) {
        if (!budget(doc)) return unresolved('work_budget');
        counts.transferElements++;
        if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) return unresolved('list_spread_or_hole');
      }
      return Object.freeze({ state: 'supported', list,
        witnesses: Object.freeze(property ? [argument, property, list] : [list]) });
    };
    const result = inspect(); cache.set(argument, result); return result;
  };
  return Object.freeze({ properties, transfer, getMetrics: () => Object.freeze({ ...counts }) });
};
