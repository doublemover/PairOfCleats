import { compilerAliasSymbol, isCompilerTransparentExpression } from './compiler-property-paths.js';

const spendClassWork = (work, reasons, reason) => {
  if (work.remaining <= 0) { reasons.add(reason); return false; }
  work.remaining--; return true;
};
const appendClassCandidates = (result, candidates, reasons, reason) => {
  for (const candidate of candidates) {
    if (result.includes(candidate)) continue;
    if (result.length === 32) { reasons.add(reason); return false; }
    result.push(candidate);
  }
  return true;
};
/** Source-backed alternatives share one work allowance across an alias tree.
 * Assignment order, runtime replacement and branch feasibility remain open. */
export const compilerClassDefinitions = ({ ts, checker, node, reasons, assignments = new Map(), seen = new Set(), work = { remaining: 256 } }) => {
  if (!node) return [];
  if (!spendClassWork(work, reasons, 'class_alias_work_budget')) return [];
  if (seen.has(node) || seen.size >= 32) { reasons.add('class_alias_candidate_budget'); return []; }
  seen = new Set(seen).add(node);
  const visit = value => compilerClassDefinitions({ ts, checker, node: value, reasons, assignments, seen, work });
  if (isCompilerTransparentExpression(ts, node)) return visit(node.expression);
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) return [node];
  const result = [], append = candidates => appendClassCandidates(result, candidates, reasons, 'class_candidate_budget');
  if (ts.isConditionalExpression(node)) {
    reasons.add('class_definition_alternatives_modeled');
    if (append(visit(node.whenTrue))) append(visit(node.whenFalse));
    return result;
  }
  if (ts.isBinaryExpression(node) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) {
    reasons.add('class_definition_alternatives_modeled');
    if (append(visit(node.left))) append(visit(node.right));
    return result;
  }
  let symbol = compilerAliasSymbol(ts, checker, node);
  if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  for (const declaration of symbol?.declarations || []) {
    if (!spendClassWork(work, reasons, 'class_alias_work_budget')) return result;
    if (ts.isClassDeclaration(declaration) || ts.isClassExpression(declaration)) {
      if (!append([declaration])) return result;
    } else if (ts.isVariableDeclaration(declaration)) {
      if (!(declaration.parent.flags & ts.NodeFlags.Const)) reasons.add('mutable_class_binding_order_and_escape_conservative');
      if (!append(visit(declaration.initializer))) return result;
    } else if (ts.isPropertyAssignment(declaration) || ts.isPropertyDeclaration(declaration)) {
      reasons.add('property_class_value_order_accessor_and_escape_conservative');
      if (declaration.initializer) {
        if (!append(visit(declaration.initializer))) return result;
      } else reasons.add('class_property_initializer_unavailable');
    } else if (ts.isShorthandPropertyAssignment(declaration)) {
      reasons.add('property_class_value_order_accessor_and_escape_conservative');
      let value = checker.getShorthandAssignmentValueSymbol(declaration);
      if (value?.flags & ts.SymbolFlags.Alias) value = checker.getAliasedSymbol(value);
      if (!value?.declarations?.length) reasons.add('class_shorthand_value_unresolved');
      for (const owner of value?.declarations || []) {
        if (!spendClassWork(work, reasons, 'class_alias_work_budget')) return result;
        if (!owner.name || owner.name === declaration.name) { reasons.add('class_shorthand_value_unresolved'); continue; }
        if (!append(visit(owner.name))) return result;
      }
    } else reasons.add('class_definition_declaration_unresolved');
  }
  const assigned = assignments.get(symbol);
  if (assigned?.length || assigned?.truncated) {
    reasons.add('mutable_class_binding_order_and_escape_conservative');
    if (assigned.truncated) reasons.add('class_alias_assignment_budget');
    for (const value of assigned) if (!append(visit(value))) break;
  }
  if (!symbol?.declarations?.length) reasons.add('class_definition_expression_unresolved');
  return result;
};
export const compilerReturnExpressions = ({ts,owner,reasons}) => {
  const result=[],pending=owner.body?[owner.body]:[];let budget=512;
  while(pending.length) {
    const node=pending.pop();if(--budget<0){reasons.add('accessor_return_scan_budget');break;}
    if(node!==owner.body&&ts.isFunctionLike(node))continue;
    if(ts.isReturnStatement(node)&&node.expression)result.push(node.expression);
    ts.forEachChild(node,child=>{pending.push(child);});
  }
  reasons.add('accessor_return_execution_and_completion_conservative');return result;
};

/** Default derived constructors forward arguments to a bounded source-backed base. */
export const compilerConstructorCandidates = ({ts,checker,definition,reasons,assignments=new Map(),seen=new Set(),work={remaining:256}}) => {
  if(!spendClassWork(work,reasons,'class_constructor_work_budget'))return [];
  if(seen.has(definition)||seen.size>=16){reasons.add('class_constructor_heritage_budget');return [];}
  seen=new Set(seen).add(definition);
  const own=definition.members?.find(member=>ts.isConstructorDeclaration(member)&&member.body);
  if(own)return [own];
  const result=[];
  for(const clause of definition.heritageClauses||[])if(clause.token===ts.SyntaxKind.ExtendsKeyword)for(const type of clause.types) {
    reasons.add('default_derived_constructor_forwarding_modeled');
    for(const parent of compilerClassDefinitions({ts,checker,node:type.expression,reasons,assignments,work})) {
      if(!appendClassCandidates(result,compilerConstructorCandidates({ts,checker,definition:parent,reasons,assignments,seen,work}),reasons,'class_constructor_candidate_budget'))return result;
    }
  }
  if(result.length>32)reasons.add('class_constructor_candidate_budget');
  return result.slice(0,32);
};
