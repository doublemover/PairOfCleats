import { canonicalSemanticJson } from './identity.js';
/** Source/symbol-owned field paths are may-locations, never a unique runtime alias proof. */
export const createCompilerFieldPaths = ({ ts, checker, owner, sourceFile, expressionFor, declarationFor, depthLimit, reasons }) => {
  const aliases = new Map(), accesses = new Map();
  const unwrap = node => { while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node))) node = node.expression; return node; };
  const property = node => {
    if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
    if (ts.isComputedPropertyName(node)) return ts.isStringLiteralLike(node.expression) || ts.isNumericLiteral(node.expression) ? node.expression.text : null;
    return null;
  };
  const root = (input, seen = new Set()) => {
    const node = unwrap(input); if (!node) return null;
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) return access(node, seen);
    if (ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node)) {
      const ref = expressionFor(node); return ref ? { root: ref, path: [], allocation: node, parameter: null, symbol: null } : null;
    }
    if (!ts.isIdentifier(node)) return null;
    const symbol = checker.getSymbolAtLocation(node);
    if (!symbol || seen.has(symbol) || seen.size >= 32) { reasons.add('field_alias_budget_or_cycle'); return null; }
    const next = new Set(seen); next.add(symbol);
    const declaration = symbol.declarations?.find(value => value.getSourceFile() === sourceFile && (ts.isVariableDeclaration(value) || ts.isParameter(value)));
    if (!declaration || !ts.isIdentifier(declaration.name)) { reasons.add('field_root_binding_pattern_or_external'); return null; }
    let result = null;
    if (ts.isVariableDeclaration(declaration) && declaration.initializer && declaration.parent.flags & ts.NodeFlags.Const) {
      const initializer = unwrap(declaration.initializer);
      if (ts.isIdentifier(initializer) || ts.isPropertyAccessExpression(initializer) || ts.isElementAccessExpression(initializer)) result = root(initializer, next);
    }
    if (!result) {
      const ref = declarationFor(declaration); if (!ref) return null;
      result = { root: ref, path: [], allocation: ts.isVariableDeclaration(declaration) ? unwrap(declaration.initializer) : null,
        parameter: (owner.parameters || []).indexOf(declaration), symbol };
      if (result.parameter < 0) result.parameter = null;
    }
    const ref = expressionFor(node);
    if (ref) aliases.set(canonicalSemanticJson(ref), { ref, root: result.root, path: result.path });
    return result;
  };
  const access = (node, seen = new Set()) => {
    const name = ts.isPropertyAccessExpression(node) ? property(node.name) : node.argumentExpression && (ts.isStringLiteralLike(node.argumentExpression) || ts.isNumericLiteral(node.argumentExpression)) ? node.argumentExpression.text : null;
    if (name === null) { reasons.add('dynamic_field_key_unresolved'); return null; }
    const base = root(node.expression, seen); if (!base) return null;
    if (base.path.length >= depthLimit) { reasons.add('field_path_depth_widened'); return null; }
    const result = { ...base, path: [...base.path, name] };
    reasons.add('heap_path_alias_accessor_and_escape_effects_conservative');
    return result;
  };
  const initial = location => {
    let node = location.allocation;
    for (const name of location.path) {
      if (!node) return null;
      if (ts.isObjectLiteralExpression(node)) {
        let selected = null;
        for (const member of node.properties) {
          if (ts.isSpreadAssignment(member) || property(member.name) === null) { reasons.add('field_initial_spread_or_computed_override'); continue; }
          if (property(member.name) !== name) continue;
          selected = ts.isPropertyAssignment(member) ? member.initializer : ts.isShorthandPropertyAssignment(member) ? member.name : null;
          if (!selected) reasons.add('field_initial_accessor_or_method_unresolved');
        }
        node = selected;
      } else if (ts.isArrayLiteralExpression(node) && /^(0|[1-9][0-9]*)$/.test(name)) {
        if (node.elements.some(element => ts.isSpreadElement(element))) { reasons.add('field_initial_array_spread_index_unknown'); return null; }
        node = node.elements[Number(name)]; if (node && ts.isOmittedExpression(node)) return null;
      } else return null;
      node = unwrap(node);
    }
    return node ? expressionFor(node) : null;
  };
  const locationFor = node => {
    if (!node || !ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return null;
    const value = access(node); if (!value) return null;
    const key = canonicalSemanticJson({ root: value.root, path: value.path });
    if (!accesses.has(key)) accesses.set(key, { ...value, key, site: expressionFor(node), initializer: initial(value) });
    return accesses.get(key);
  };
  const rootFor = node => {
    const result = root(node), ref = node && expressionFor(node);
    if (result && ref) aliases.set(canonicalSemanticJson(ref), { ref, root: result.root, path: result.path });
    return result;
  };
  return { rootFor, locationFor, accesses, aliases };
};
