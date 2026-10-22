import { isCompilerTransparentExpression } from './compiler-property-paths.js';

/** Distinguish erased syntax from runtime value syntax in one compiler tree.
 * In particular, a type query resolves a value name without evaluating it.
 * Class extends evaluates its expression; implements/interface heritage do not.
 */
export const createCompilerRuntimeContext = ts => {
  const runtime = new WeakMap();
  const classHeritage = node => node && ts.isHeritageClause(node) && node.token === ts.SyntaxKind.ExtendsKeyword
    && (ts.isClassDeclaration(node.parent) || ts.isClassExpression(node.parent));
  const erased = node => {
    if (ts.isSourceFile(node)) return node.isDeclarationFile;
    if (node.flags & ts.NodeFlags.Ambient
      || node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword)) return true;
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && node.name.text === 'this') return true;
    if (ts.isExpressionWithTypeArguments(node)) return !classHeritage(node.parent);
    if (ts.isHeritageClause(node)) return !classHeritage(node);
    return ts.isTypeNode(node) || ts.isTypeParameterDeclaration(node)
      || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)
      || ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || ts.isExportDeclaration(node);
  };
  const isRuntimeNode = node => {
    if (!node) return false;
    const path = [];
    let current = node;
    while (current && !runtime.has(current) && !erased(current)) { path.push(current); current = current.parent; }
    const admitted = !current || runtime.has(current) && runtime.get(current);
    if (current && !runtime.has(current)) runtime.set(current, false);
    for (const child of path) runtime.set(child, admitted);
    return Boolean(admitted);
  };
  const isLexicalValueRead = node => {
    if (!node || !ts.isIdentifier(node) || !isRuntimeNode(node)) return false;
    const parent = node.parent;
    if (!parent) return true;
    if (ts.isPropertyAccessExpression(parent) && parent.name === node
      || ts.isPropertyAssignment(parent) && parent.name === node
      || ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)
      || parent.name === node && !ts.isShorthandPropertyAssignment(parent)
      || ts.isLabeledStatement(parent) && parent.label === node
      || (ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === node) return false;
    let target = node;
    while (target.parent?.expression === target && isCompilerTransparentExpression(ts, target.parent)) target = target.parent;
    const owner = target.parent;
    if (owner && (ts.isBinaryExpression(owner) && owner.left === target && owner.operatorToken.kind === ts.SyntaxKind.EqualsToken
      || ts.isDeleteExpression(owner) && owner.expression === target
      || (ts.isForInStatement(owner) || ts.isForOfStatement(owner)) && owner.initializer === target)) return false;
    return true;
  };
  return { isRuntimeNode, isLexicalValueRead };
};
