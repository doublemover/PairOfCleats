/** Accessor invocation candidates use the existing call-site summary contract. */
export const collectCompilerImplicitCalls = ({ts,checker,nodes,expressionFor,declarationRef}) => {
  const calls=[];
  for(const node of nodes) {
    if(!ts.isPropertyAccessExpression(node)&&!ts.isElementAccessExpression(node))continue;
    const parent=node.parent, assignment=ts.isBinaryExpression(parent)&&parent.left===node&&parent.operatorToken.kind===ts.SyntaxKind.EqualsToken;
    const write=ts.isBinaryExpression(parent)&&parent.left===node&&parent.operatorToken.kind>=ts.SyntaxKind.FirstAssignment&&parent.operatorToken.kind<=ts.SyntaxKind.LastAssignment;
    const update=(ts.isPrefixUnaryExpression(parent)||ts.isPostfixUnaryExpression(parent))&&[ts.SyntaxKind.PlusPlusToken,ts.SyntaxKind.MinusMinusToken].includes(parent.operator);
    const symbol=checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node)?node.name:node);
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
