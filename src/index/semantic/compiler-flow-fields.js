import { canonicalSemanticJson } from './identity.js';
import { compilerRuntimeParameters } from './compiler-invocation.js';
import { compilerClassDefinitions, compilerReturnExpressions } from './compiler-object-model.js';
import { compilerPropertyKeys, propertyKeySetsOverlap } from './compiler-property-paths.js';
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
    const symbol = ts.isShorthandPropertyAssignment(node.parent) ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
    if (!symbol || seen.has(symbol)) { reasons.add('field_alias_budget_or_cycle'); return []; }
    next.add(symbol);
    const declaration = symbol.declarations?.find(value => value.getSourceFile() === sourceFile && (ts.isVariableDeclaration(value) || ts.isParameter(value) || ts.isBindingElement(value)));
    if (!declaration || !ts.isIdentifier(declaration.name)) { reasons.add('field_root_binding_pattern_or_external'); return []; }
    if (ts.isBindingElement(declaration)) {
      const bindingRoot = (element, depth = 0) => {
        if (depth >= depthLimit) { reasons.add('field_binding_depth_budget'); return []; }
        if (element.dotDotDotToken) { reasons.add('field_binding_rest_copy_unresolved'); return []; }
        const pattern = element.parent, parent = pattern.parent;
        let bases = ts.isBindingElement(parent) ? bindingRoot(parent,depth+1) : root(parent.initializer,next);
        const keys = ts.isArrayBindingPattern(pattern) ? [String(pattern.elements.indexOf(element))]
          : compilerPropertyKeys({ts,checker,node:element.propertyName || element.name,reasons});
        bases = unique(bases.flatMap(base => {
          if (base.path.length >= depthLimit) { reasons.add('field_path_depth_widened'); return []; }
          return keys.map(name => ({...base,path:[...base.path,name]}));
        }));
        if (element.initializer) { bases.push(...root(element.initializer,next)); reasons.add('field_binding_default_execution_conservative'); }
        return unique(bases);
      };
      let result = bindingRoot(declaration);
      let bindingOwner = declaration.parent;
      while (ts.isBindingElement(bindingOwner) || ts.isObjectBindingPattern(bindingOwner) || ts.isArrayBindingPattern(bindingOwner)) bindingOwner = bindingOwner.parent;
      if (ts.isVariableDeclaration(bindingOwner) && !(bindingOwner.parent.flags & ts.NodeFlags.Const)) {
        for (const value of assignments.get(symbol) || []) result.push(...root(value,next));
        if (assignments.get(symbol)?.truncated) reasons.add('field_alias_assignment_budget');
        const ref = declarationFor(declaration);
        if (ref) result.push({root:ref,path:[],allocation:null,parameter:null});
        reasons.add('mutable_field_alias_order_and_escape_conservative');
      }
      result = unique(result);
      const site = expressionFor(node);
      reasons.add('field_binding_snapshot_and_escape_conservative');
      if (site) for (const value of result) aliases.set(canonicalSemanticJson({ref:site,root:value.root,path:value.path}), {ref:site,root:value.root,path:value.path});
      return result;
    }
    const ref = declarationFor(declaration); if (!ref) return [];
    const parameter = compilerRuntimeParameters(ts,owner).indexOf(declaration);
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
    let budget = 256;
    const limit = values => {
      if (values.length > 32) reasons.add('field_initial_candidate_budget');
      return values.slice(0,32);
    };
    const work = () => {
      if (--budget >= 0) return true;
      reasons.add('field_initial_work_budget'); return false;
    };
    const read = (input, path, seen = new Set()) => {
      const node = unwrap(input);
      if (!node) return [];
      if (--budget < 0 || seen.has(node) || seen.size >= 32) { reasons.add('field_initial_alias_budget_or_cycle'); return []; }
      seen = new Set(seen).add(node);
      if (!path.length) return [node];
      if (ts.isConditionalExpression(node)) return limit([...read(node.whenTrue,path,seen),...read(node.whenFalse,path,seen)]);
      if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        return limit(root(node).flatMap(base => base.allocation ? read(base.allocation,[...base.path,...path],seen) : []));
      }
      const [name,...remaining] = path, next = [];
      if (ts.isObjectLiteralExpression(node)) {
        for (const member of node.properties) {
          if (!work()) break;
          if (ts.isSpreadAssignment(member)) {
            next.push(...read(member.expression,path,seen));
            reasons.add('field_initial_spread_or_computed_override'); continue;
          }
          if (!propertyKeySetsOverlap([name],compilerPropertyKeys({ts,checker,node:member.name,reasons}))) continue;
          const value = ts.isPropertyAssignment(member) ? member.initializer : ts.isShorthandPropertyAssignment(member) ? member.name : null;
          if (value) next.push(...read(value,remaining,seen));
          else if (ts.isGetAccessorDeclaration(member)) for (const value of compilerReturnExpressions({ts,owner:member,reasons})) next.push(...read(value,remaining,seen));
          else reasons.add('field_initial_accessor_or_method_unresolved');
        }
      } else if (ts.isNewExpression(node)) {
        const classes=compilerClassDefinitions({ts,checker,node:node.expression,reasons}),visited=new Set();
        while(classes.length) {
          const definition=classes.pop();if(visited.has(definition))continue;visited.add(definition);
          if(visited.size>16){reasons.add('field_initial_heritage_budget');break;}
          for(const member of definition.members) {
            if (!work()) break;
            if(!member.name||member.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.StaticKeyword)||!propertyKeySetsOverlap([name],compilerPropertyKeys({ts,checker,node:member.name,reasons})))continue;
            if(ts.isPropertyDeclaration(member)&&member.initializer)next.push(...read(member.initializer,remaining,seen));
            else if(ts.isGetAccessorDeclaration(member))for(const value of compilerReturnExpressions({ts,owner:member,reasons}))next.push(...read(value,remaining,seen));
          }
          for(const clause of definition.heritageClauses||[])if(clause.token===ts.SyntaxKind.ExtendsKeyword)for(const type of clause.types)classes.push(...compilerClassDefinitions({ts,checker,node:type.expression,reasons}));
        }
        reasons.add('constructor_return_override_initializer_order_and_escape_conservative');
      } else if (ts.isArrayLiteralExpression(node)) {
        const spread = node.elements.some(element => ts.isSpreadElement(element));
        if (spread) reasons.add('field_initial_array_spread_index_unknown');
        if (name === null || spread) for (const element of node.elements) {
          if (!work()) break;
          if (ts.isOmittedExpression(element)) continue;
          next.push(...read(ts.isSpreadElement(element)?element.expression:element,ts.isSpreadElement(element)?[null,...remaining]:remaining,seen));
        }
        else if (typeof name==='string' && /^(0|[1-9][0-9]*)$/.test(name)) next.push(...read(node.elements[Number(name)],remaining,seen));
      } else reasons.add('field_initial_constructor_or_prototype_unresolved');
      return limit(next);
    };
    return read(location.allocation,location.path).map(expressionFor).filter(Boolean);
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
