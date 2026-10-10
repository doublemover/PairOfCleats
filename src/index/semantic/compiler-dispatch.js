import { canonicalSemanticJson } from './identity.js';
import { compilerPropertyKeys } from './compiler-property-paths.js';
import { collectCompilerAliasAssignments } from './compiler-flow-fields.js';
/** Source-backed call candidates augment checker signatures. Property/prototype
 * lookup stays modeled: getters, proxies, escaping receivers and replacement are
 * open-world effects, even when a constructor or literal allocation is visible. */
export const createCompilerDispatchResolver = ({ts,checker,nodes,declarationRef}) => {
  nodes=[...nodes];
  const writes = new Map(), assignments=collectCompilerAliasAssignments(ts,checker,nodes);
  const unwrap = node => { while(node && (ts.isParenthesizedExpression(node)||ts.isAsExpression(node)||ts.isNonNullExpression(node)||ts.isTypeAssertionExpression(node))) node=node.expression; return node; };
  const symbolFor = node => { let symbol=checker.getSymbolAtLocation(node); if(symbol?.flags & ts.SymbolFlags.Alias) symbol=checker.getAliasedSymbol(symbol); return symbol; };
  for(const node of nodes) if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.EqualsToken) {
    const left=node.left;
    if(!ts.isPropertyAccessExpression(left)&&!ts.isElementAccessExpression(left)) continue;
    let receiver=left.expression;
    const prototype=ts.isPropertyAccessExpression(receiver)&&receiver.name.text==='prototype';
    if(prototype)receiver=receiver.expression;
    const symbol=symbolFor(receiver); if(!symbol)continue;
    if(!writes.has(symbol))writes.set(symbol,[]);
    const list=writes.get(symbol); if(list.length<64)list.push({left,value:node.right,prototype}); else list.truncated=true;
  }
  return node => {
    const reasons=new Set(), found=[], seen=new Set(); let budget=256, incomplete=false, modeled=false, propertyDispatch=false;
    const add = candidate => {
      const owner=ts.isFunctionLike(candidate)&&candidate.parent?.initializer===candidate&&ts.isVariableDeclaration(candidate.parent)?candidate.parent:candidate;
      const ref=declarationRef(owner); if(ref)found.push(ref); else incomplete=true;
    };
    const keys = expression => compilerPropertyKeys({ts,checker,node:ts.isPropertyAccessExpression(expression)?expression.name:expression.argumentExpression,computed:ts.isElementAccessExpression(expression),reasons});
    const matches = (a,b) => a.includes(null)||b.includes(null)||a.some(value=>b.includes(value));
    const declarations = input => {
      const symbol=symbolFor(input); return symbol?.declarations || [];
    };
    const visit = input => {
      input=unwrap(input); if(!input)return;
      if(--budget<0||seen.has(input)) { incomplete=true; reasons.add('dispatch_candidate_budget_or_cycle'); return; }
      seen.add(input);
      if(ts.isFunctionLike(input)) { add(input); return; }
      if(ts.isConditionalExpression(input)) { modeled=true; visit(input.whenTrue); visit(input.whenFalse); return; }
      if(ts.isBinaryExpression(input)&&[ts.SyntaxKind.BarBarToken,ts.SyntaxKind.AmpersandAmpersandToken,ts.SyntaxKind.QuestionQuestionToken].includes(input.operatorToken.kind)) { modeled=true; visit(input.left); visit(input.right); return; }
      if(ts.isIdentifier(input)) {
        const values=declarations(input), assigned=assignments.get(symbolFor(input));
        if(assigned?.length) {modeled=true;incomplete=true;reasons.add('callable_assignment_order_and_escape_conservative');for(const value of assigned)visit(value);if(assigned.truncated)reasons.add('dispatch_callable_assignment_budget');}
        if(!values.length)incomplete=true;
        for(const declaration of values) {
          if(ts.isFunctionLike(declaration)) { add(declaration); continue; }
          if(ts.isVariableDeclaration(declaration)&&declaration.initializer) {
            if(!(declaration.parent.flags & ts.NodeFlags.Const)) { incomplete=true; modeled=true; reasons.add('mutable_callable_binding_unresolved'); }
            visit(declaration.initializer);
          } else if(ts.isClassDeclaration(declaration)||ts.isClassExpression(declaration)) {
            const constructor=declaration.members.find(ts.isConstructorDeclaration); add(constructor||declaration);
          } else incomplete=true;
        }
        return;
      }
      if(ts.isPropertyAccessExpression(input)||ts.isElementAccessExpression(input)) {
        modeled=true; propertyDispatch=true; incomplete=true; reasons.add('property_dispatch_prototype_accessor_or_escape_unobserved');
        property(input.expression,keys(input)); return;
      }
      incomplete=true;
    };
    const patch = (receiver,names,prototype) => {
      if(writes.get(symbolFor(receiver))?.truncated) {incomplete=true;reasons.add('dispatch_property_assignment_budget');}
      for(const write of writes.get(symbolFor(receiver))||[]) if(write.prototype===prototype && matches(keys(write.left),names)) visit(write.value);
    };
    const classMember = (definition,names,staticMember,visited=new Set()) => {
      if(visited.has(definition)||visited.size>=16||--budget<0) { incomplete=true; reasons.add('class_heritage_candidate_budget'); return; }
      visited=new Set(visited).add(definition);
      let matched=false;
      for(const member of definition.members||[]) {
        if(Boolean(member.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.StaticKeyword))!==staticMember||!member.name)continue;
        const memberKeys=compilerPropertyKeys({ts,checker,node:member.name,reasons});
        if(!matches(memberKeys,names))continue; matched=true;
        if(ts.isMethodDeclaration(member))add(member);
        else if(ts.isPropertyDeclaration(member)&&member.initializer)visit(member.initializer);
        else { incomplete=true; reasons.add('accessor_returned_callable_unresolved'); }
      }
      if(definition.name)patch(definition.name,names,!staticMember);
      if(!matched || names.includes(null)) for(const clause of definition.heritageClauses||[]) if(clause.token===ts.SyntaxKind.ExtendsKeyword) for(const type of clause.types) {
        for(const parent of declarations(type.expression)) if(ts.isClassDeclaration(parent)||ts.isClassExpression(parent))classMember(parent,names,staticMember,visited);
      }
    };
    const property = (receiver,names,visited=new Set()) => {
      receiver=unwrap(receiver); if(!receiver)return;
      if(visited.has(receiver)||visited.size>=32||--budget<0) { incomplete=true; reasons.add('receiver_alias_candidate_budget'); return; }
      visited=new Set(visited).add(receiver);
      if(ts.isConditionalExpression(receiver)) { property(receiver.whenTrue,names,visited); property(receiver.whenFalse,names,visited); return; }
      if(ts.isIdentifier(receiver)) {
        patch(receiver,names,false);
        for(const declaration of declarations(receiver)) {
          if(ts.isVariableDeclaration(declaration)&&declaration.initializer)property(declaration.initializer,names,visited);
          else if(ts.isClassDeclaration(declaration)||ts.isClassExpression(declaration))classMember(declaration,names,true);
          else incomplete=true;
        }
      } else if(ts.isNewExpression(receiver)) {
        for(const definition of declarations(receiver.expression)) if(ts.isClassDeclaration(definition)||ts.isClassExpression(definition))classMember(definition,names,false);
        patch(receiver.expression,names,true);
      } else if(ts.isObjectLiteralExpression(receiver)) {
        for(const member of receiver.properties) {
          if(ts.isSpreadAssignment(member)) { property(member.expression,names,visited); continue; }
          if(!matches(compilerPropertyKeys({ts,checker,node:member.name,reasons}),names))continue;
          if(ts.isMethodDeclaration(member))add(member);
          else if(ts.isPropertyAssignment(member))visit(member.initializer);
          else if(ts.isShorthandPropertyAssignment(member)) {
            const symbol=checker.getShorthandAssignmentValueSymbol(member); for(const declaration of symbol?.declarations||[]) if(ts.isFunctionLike(declaration))add(declaration); else if(declaration.initializer)visit(declaration.initializer);
          } else reasons.add('accessor_returned_callable_unresolved');
        }
      } else if(receiver.kind===ts.SyntaxKind.ThisKeyword||receiver.kind===ts.SyntaxKind.SuperKeyword) {
        let owner=receiver.parent,member=null; while(owner&&!ts.isClassDeclaration(owner)&&!ts.isClassExpression(owner)){member=owner;owner=owner.parent;}
        const staticMember=Boolean(member?.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.StaticKeyword));
        if(owner) {
          if(receiver.kind===ts.SyntaxKind.ThisKeyword)classMember(owner,names,staticMember);
          else for(const clause of owner.heritageClauses||[]) for(const type of clause.types) for(const parent of declarations(type.expression))classMember(parent,names,staticMember);
        }
      } else incomplete=true;
    };
    visit(node.expression||node.tag);
    const targets=[...new Map(found.map(ref=>[canonicalSemanticJson(ref),ref])).values()];
    if(targets.length>32) { incomplete=true; reasons.add('dispatch_target_budget'); }
    const callee=unwrap(node.expression||node.tag);
    const excludedTargets=(ts.isPropertyAccessExpression(callee)||ts.isElementAccessExpression(callee)?declarations(ts.isPropertyAccessExpression(callee)?callee.name:callee):[]).filter(value=>ts.isGetAccessorDeclaration(value)||ts.isSetAccessorDeclaration(value)).map(declarationRef).filter(Boolean);
    return {targets:targets.slice(0,32),incomplete,modeled,propertyDispatch,excludedTargets,reasons:[...reasons]};
  };
};
