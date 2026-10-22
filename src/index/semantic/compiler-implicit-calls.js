import { compilerAliasSymbol } from './compiler-property-paths.js';

/** Accessor invocation candidates use the existing call-site summary contract. */
export const collectCompilerImplicitCalls = ({ts,checker,nodes,expressionFor,declarationRef}) => {
  const calls=[];
  for(const node of nodes) {
    if(!ts.isPropertyAccessExpression(node)&&!ts.isElementAccessExpression(node))continue;
    let target=node;
    while(target.parent && target.parent.expression===target && (ts.isParenthesizedExpression(target.parent)
      || ts.isNonNullExpression(target.parent) || ts.isAsExpression(target.parent) || ts.isTypeAssertionExpression(target.parent)
      || ts.isSatisfiesExpression(target.parent))) target=target.parent;
    const parent=target.parent;
    // Delete evaluates a reference and removes its property; it never invokes
    // that property's getter or setter. Receiver subexpressions still run.
    if(ts.isDeleteExpression(parent) && parent.expression===target)continue;
    const assignment=ts.isBinaryExpression(parent)&&parent.left===target&&parent.operatorToken.kind===ts.SyntaxKind.EqualsToken;
    const write=ts.isBinaryExpression(parent)&&parent.left===target&&parent.operatorToken.kind>=ts.SyntaxKind.FirstAssignment&&parent.operatorToken.kind<=ts.SyntaxKind.LastAssignment;
    const update=(ts.isPrefixUnaryExpression(parent)||ts.isPostfixUnaryExpression(parent))&&[ts.SyntaxKind.PlusPlusToken,ts.SyntaxKind.MinusMinusToken].includes(parent.operator);
    const symbol=compilerAliasSymbol(ts,checker,node);
    for(const setter of [false,true]) {
      if(setter&&!write&&!update||!setter&&assignment)continue;
      const declarations=(symbol?.declarations||[]).filter(setter?ts.isSetAccessorDeclaration:ts.isGetAccessorDeclaration),targets=declarations.map(declarationRef).filter(Boolean);
      if(!targets.length)continue;
      calls.push({node,occurrence:expressionFor(node),span:[node.getStart(),node.end],targets,incompleteTargets:true,invocationKind:setter?'setter':'getter',
        receiver:expressionFor(node.expression),arguments:setter?[expressionFor(assignment?parent.right:parent)]:[],result:expressionFor(node),suppressResult:setter,hasSpread:false,
        reason:'accessor_invocation_receiver_and_descriptor_mutation_conservative'});
    }
  }
  return calls;
};
