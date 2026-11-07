import { compilerAliasSymbol, isCompilerTransparentExpression } from './compiler-property-paths.js';
import { createCompilerRuntimeContext } from './compiler-runtime-context.js';

/** Accessor invocation candidates use the existing call-site summary contract. */
export const collectCompilerImplicitCalls = ({ts,checker,nodes,expressionFor,declarationRef}) => {
  const calls=[];
  const { isRuntimeNode } = createCompilerRuntimeContext(ts);
  const destructuringAssignment = target => {
    let current = target, pattern = false, selected = null;
    const defaults = [];
    while (current?.parent) {
      const parent = current.parent;
      if (parent.expression === current && isCompilerTransparentExpression(ts, parent)) { current = parent; continue; }
      if (ts.isBinaryExpression(parent) && parent.left === current && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        // A nested `target = fallback` may be a pattern default. Keep its
        // ordinary assignment interpretation unless an outer pattern owns it.
        selected = { pattern, source: parent.right, defaultCount: defaults.length };
        defaults.push(parent.right); current = parent; continue;
      }
      if ((ts.isForOfStatement(parent) || ts.isForInStatement(parent)) && parent.initializer === current) {
        return pattern ? { inputs: [parent.expression, ...defaults], iteration: true } : null;
      }
      if (ts.isArrayLiteralExpression(parent) || ts.isObjectLiteralExpression(parent)
        || ts.isPropertyAssignment(parent) && parent.initializer === current
        || (ts.isSpreadElement(parent) || ts.isSpreadAssignment(parent)) && parent.expression === current) {
        pattern = true; current = parent; continue;
      }
      break;
    }
    return selected?.pattern ? { inputs: [selected.source, ...defaults.slice(0, selected.defaultCount)] } : null;
  };
  for(const node of nodes) {
    if(!isRuntimeNode(node)||!ts.isPropertyAccessExpression(node)&&!ts.isElementAccessExpression(node))continue;
    let target=node;
    while(target.parent && target.parent.expression===target && isCompilerTransparentExpression(ts,target.parent)) target=target.parent;
    const parent=target.parent;
    // Delete evaluates a reference and removes its property; it never invokes
    // that property's getter or setter. Receiver subexpressions still run.
    if(ts.isDeleteExpression(parent) && parent.expression===target)continue;
    const pattern = destructuringAssignment(target);
    const iteration=Boolean(pattern?.iteration)||(ts.isForOfStatement(parent)||ts.isForInStatement(parent))&&parent.initializer===target;
    const assignment=Boolean(pattern)||iteration||ts.isBinaryExpression(parent)&&parent.left===target&&parent.operatorToken.kind===ts.SyntaxKind.EqualsToken;
    const write=Boolean(pattern)||iteration||ts.isBinaryExpression(parent)&&parent.left===target&&parent.operatorToken.kind>=ts.SyntaxKind.FirstAssignment&&parent.operatorToken.kind<=ts.SyntaxKind.LastAssignment;
    const update=(ts.isPrefixUnaryExpression(parent)||ts.isPostfixUnaryExpression(parent))&&[ts.SyntaxKind.PlusPlusToken,ts.SyntaxKind.MinusMinusToken].includes(parent.operator);
    const symbol=compilerAliasSymbol(ts,checker,node);
    for(const setter of [false,true]) {
      if(setter&&!write&&!update||!setter&&assignment)continue;
      const declarations=(symbol?.declarations||[]).filter(setter?ts.isSetAccessorDeclaration:ts.isGetAccessorDeclaration),targets=declarations.map(declarationRef).filter(Boolean);
      if(!targets.length)continue;
      // Update lowering owns the complete ++/-- operation rather than a
      // separate property-value expression. Bind both implicit accessor calls
      // to that retained operation when the property has no independent row.
      const occurrence = expressionFor(node) || (update ? expressionFor(parent) : null);
      calls.push({node,occurrence,span:[node.getStart(),node.end],targets,incompleteTargets:true,invocationKind:setter?'setter':'getter',
        receiver:expressionFor(node.expression),arguments:setter?[pattern||iteration?null:expressionFor(assignment?parent.right:parent)]:[],
        unknownInputs:(pattern ? pattern.inputs : iteration ? [parent.expression] : []).map(value=>expressionFor(value)).filter(Boolean),result:occurrence,suppressResult:setter,hasSpread:false,
        reason:'accessor_invocation_receiver_and_descriptor_mutation_conservative'+(iteration?';iteration_assignment_value_unresolved':'')
          +(pattern?';destructuring_assignment_value_unresolved':'')});
    }
  }
  return calls;
};
