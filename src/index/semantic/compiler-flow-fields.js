import { canonicalSemanticJson } from './identity.js';
import { compilerPropertyKeys } from './compiler-property-paths.js';
export const collectCompilerAliasAssignments = (ts, checker, nodes) => {
  const assignments = new Map();
  for (const node of nodes) if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) {
    const symbol = checker.getSymbolAtLocation(node.left);
    if (symbol) { if (!assignments.has(symbol)) assignments.set(symbol, []); const values = assignments.get(symbol); if (values.length < 32) values.push(node.right); else values.truncated = true; }
  }
  return assignments;
};
/** Bounded may-locations. Mutable aliases union all indexed assignments, retaining
 * an unknown binding root; no assignment-order or unique-alias claim is made. */
export const createCompilerFieldPaths = ({ ts, checker, owner, sourceFile, assignments = new Map(), expressionFor, declarationFor, depthLimit, reasons }) => {
  const aliases = new Map(), accesses = new Map();
  const unwrap = node => { while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node))) node = node.expression; return node; };
  const unique = values => {
    const result = [...new Map(values.filter(Boolean).map(value => [canonicalSemanticJson({root:value.root,path:value.path}), value])).values()];
    if (result.length > 32) reasons.add('field_alias_candidate_budget');
    return result.slice(0,32);
  };
  const root = (input, seen = new Set()) => {
    const node = unwrap(input); if (!node) return [];
    if (seen.has(node) || seen.size >= 32) { reasons.add('field_alias_budget_or_cycle'); return []; }
    const next = new Set(seen).add(node);
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) return access(node, next);
    if (ts.isConditionalExpression(node)) return unique([...root(node.whenTrue,next), ...root(node.whenFalse,next)]);
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.BarBarToken,ts.SyntaxKind.AmpersandAmpersandToken,ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) return unique([...root(node.left,next), ...root(node.right,next)]);
    if (ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node) || ts.isNewExpression(node)) {
      const ref = expressionFor(node); return ref ? [{ root: ref, path: [], allocation: node, parameter: null }] : [];
    }
    if (node.kind === ts.SyntaxKind.ThisKeyword || node.kind === ts.SyntaxKind.SuperKeyword) {
      const ref = expressionFor(owner); if (!ref) return [];
      reasons.add(ts.isArrowFunction(owner)?'lexical_arrow_receiver_unresolved':'receiver_identity_and_prototype_dispatch_conservative');
      return [{root:ref,path:[],allocation:null,parameter:ts.isArrowFunction(owner)?null:-1,receiver:!ts.isArrowFunction(owner)}];
    }
    if (!ts.isIdentifier(node)) return [];
    const symbol = checker.getSymbolAtLocation(node);
    if (!symbol || seen.has(symbol)) { reasons.add('field_alias_budget_or_cycle'); return []; }
    next.add(symbol);
    const declaration = symbol.declarations?.find(value => value.getSourceFile() === sourceFile && (ts.isVariableDeclaration(value) || ts.isParameter(value)));
    if (!declaration || !ts.isIdentifier(declaration.name)) { reasons.add('field_root_binding_pattern_or_external'); return []; }
    const ref = declarationFor(declaration); if (!ref) return [];
    const parameter = (owner.parameters || []).indexOf(declaration);
    const fallback = {root:ref,path:[],allocation:null,parameter:parameter < 0 ? null : parameter};
    let result = ts.isVariableDeclaration(declaration) ? root(declaration.initializer,next) : [];
    if (ts.isVariableDeclaration(declaration) && !(declaration.parent.flags & ts.NodeFlags.Const)) {
      if(assignments.get(symbol)?.truncated) reasons.add('field_alias_assignment_budget');
      for (const value of assignments.get(symbol) || []) result.push(...root(value,next));
      result.push(fallback); reasons.add('mutable_field_alias_order_and_escape_conservative');
    }
    if (!result.length) result.push(fallback);
    result = unique(result);
    const site = expressionFor(node);
    if (site) for (const value of result) aliases.set(canonicalSemanticJson({ref:site,root:value.root,path:value.path}), {ref:site,root:value.root,path:value.path});
    return result;
  };
  const access = (node, seen) => {
    const keys = compilerPropertyKeys({ts,checker,node:ts.isPropertyAccessExpression(node) ? node.name : node.argumentExpression,computed:ts.isElementAccessExpression(node),reasons});
    const result = [];
    for (const base of root(node.expression,seen)) {
      if (base.path.length >= depthLimit) { reasons.add('field_path_depth_widened'); continue; }
      for (const name of keys) result.push({...base,path:[...base.path,name]});
    }
    reasons.add('heap_path_alias_accessor_and_escape_effects_conservative');
    return unique(result);
  };
  const initial = location => {
    let candidates = [location.allocation];
    for (const name of location.path) {
      const next = [];
      for (let node of candidates) {
        node = unwrap(node); if (!node) continue;
        if (ts.isObjectLiteralExpression(node)) {
          for (const member of node.properties) {
            if (ts.isSpreadAssignment(member)) { next.push(member.expression); reasons.add('field_initial_spread_or_computed_override'); continue; }
            const keys = compilerPropertyKeys({ts,checker,node:member.name,reasons});
            if (name !== null && !keys.includes(null) && !keys.includes(name)) continue;
            const value = ts.isPropertyAssignment(member) ? member.initializer : ts.isShorthandPropertyAssignment(member) ? member.name : null;
            if (value) next.push(value); else reasons.add('field_initial_accessor_or_method_unresolved');
          }
        } else if (ts.isArrayLiteralExpression(node)) {
          const spread = node.elements.some(element => ts.isSpreadElement(element));
          if (spread) reasons.add('field_initial_array_spread_index_unknown');
          if (name === null || spread) next.push(...node.elements.filter(element=>!ts.isOmittedExpression(element)).map(element=>ts.isSpreadElement(element)?element.expression:element));
          else if (/^(0|[1-9][0-9]*)$/.test(name)) next.push(node.elements[Number(name)]);
        } else reasons.add('field_initial_constructor_or_prototype_unresolved');
      }
      candidates = next.slice(0,32); if(next.length>32) reasons.add('field_initial_candidate_budget');
    }
    return candidates.map(node=>node&&expressionFor(node)).filter(Boolean);
  };
  const locationsFor = node => {
    if (!node || !ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return [];
    return access(node,new Set()).map(value=>{
      const key = canonicalSemanticJson({root:value.root,path:value.path});
      if(!accesses.has(key)) accesses.set(key,{...value,key,site:expressionFor(node),initializers:initial(value)});
      return accesses.get(key);
    });
  };
  const rootsFor = node => {
    const values = root(node), ref = node && expressionFor(node);
    if(ref) for(const value of values) aliases.set(canonicalSemanticJson({ref,root:value.root,path:value.path}), {ref,root:value.root,path:value.path});
    return values;
  };
  return {rootsFor,rootFor:node=>rootsFor(node)[0]||null,locationsFor,locationFor:node=>locationsFor(node)[0]||null,accesses,aliases};
};
