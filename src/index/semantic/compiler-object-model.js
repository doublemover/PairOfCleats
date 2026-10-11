/** Small source-backed class/return queries shared by field and dispatch owners. */
export const compilerClassDefinitions = ({ts,checker,node,reasons,seen=new Set()}) => {
  if(!node)return [];
  if(seen.has(node)||seen.size>=32){reasons.add('class_alias_candidate_budget');return [];}
  seen=new Set(seen).add(node);
  if(ts.isParenthesizedExpression(node)||ts.isAsExpression(node)||ts.isNonNullExpression(node))return compilerClassDefinitions({ts,checker,node:node.expression,reasons,seen});
  if(ts.isClassDeclaration(node)||ts.isClassExpression(node))return [node];
  let symbol=checker.getSymbolAtLocation(node);if(symbol?.flags&ts.SymbolFlags.Alias)symbol=checker.getAliasedSymbol(symbol);
  const result=[];
  for(const declaration of symbol?.declarations||[]) {
    if(ts.isClassDeclaration(declaration)||ts.isClassExpression(declaration))result.push(declaration);
    else if(ts.isVariableDeclaration(declaration)&&declaration.initializer)result.push(...compilerClassDefinitions({ts,checker,node:declaration.initializer,reasons,seen}));
    if(result.length>=32){reasons.add('class_candidate_budget');break;}
  }
  return result.slice(0,32);
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
export const compilerConstructorCandidates = ({ts,checker,definition,reasons,seen=new Set()}) => {
  if(seen.has(definition)||seen.size>=16){reasons.add('class_constructor_heritage_budget');return [];}
  seen=new Set(seen).add(definition);
  const own=definition.members?.find(member=>ts.isConstructorDeclaration(member)&&member.body);
  if(own)return [own];
  const result=[];
  for(const clause of definition.heritageClauses||[])if(clause.token===ts.SyntaxKind.ExtendsKeyword)for(const type of clause.types) {
    reasons.add('default_derived_constructor_forwarding_modeled');
    for(const parent of compilerClassDefinitions({ts,checker,node:type.expression,reasons}))result.push(...compilerConstructorCandidates({ts,checker,definition:parent,reasons,seen}));
  }
  if(result.length>32)reasons.add('class_constructor_candidate_budget');
  return result.slice(0,32);
};
