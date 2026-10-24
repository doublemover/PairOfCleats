import { isCompilerTransparentExpression } from './compiler-property-paths.js';
/** Runtime value inputs shared by CFG emission and the immutable value slice.
 * Syntax children are not interchangeable with value inputs: types, property
 * names, template text and evaluated-but-discarded operands stay separate.
 */
export const compilerOperationDependencies = (ts, node) => {
  if (!node || ts.isTypeNode(node)) return null;
  const input = (value, kind = 'flowsTo', certainty = 'exact-static', condition = null) =>
    ({ node: value, kind, certainty, condition });
  const result = (inputs = [], extra = {}) => ({ inputs, reason: null, mayThrow: false, requiresCfg: false, ...extra });
  if (isCompilerTransparentExpression(ts, node)) return result([input(node.expression)]);
  if (ts.isTemplateExpression(node)) return result(node.templateSpans.map(span => input(span.expression, 'flowsTo', 'modeled')),
    { mayThrow: true });
  if (ts.isTemplateSpan(node)) return result([input(node.expression)]);
  if (ts.isComputedPropertyName(node)) return result([input(node.expression, 'flowsTo', 'modeled')],
    { reason: 'property_key_coercion_effects_unresolved', mayThrow: true });
  if (ts.isAwaitExpression(node) || ts.isYieldExpression(node)) return result(node.expression ? [input(node.expression, 'flowsTo', 'modeled')] : [],
    { reason: 'suspension_shared_effects_unresolved', mayThrow: ts.isAwaitExpression(node) });
  if (ts.isObjectLiteralExpression(node)) return result(node.properties.map(member => input(
    ts.isPropertyAssignment(member) ? member.initializer : ts.isShorthandPropertyAssignment(member) ? member.name : member,
    'packs', 'modeled')));
  if (ts.isArrayLiteralExpression(node)) return result(node.elements.filter(element => !ts.isOmittedExpression(element))
    .map(element => input(element, 'packs', 'modeled')));
  if (ts.isPropertyAssignment(node)) return result([input(node.initializer, 'packs', 'modeled')]);
  if (ts.isShorthandPropertyAssignment(node)) return result([input(node.name, 'packs', 'modeled')]);
  if (ts.isSpreadElement(node) || ts.isSpreadAssignment(node)) return result([input(node.expression, 'packs', 'modeled')],
    { reason: 'spread_iteration_or_accessor_effects_unresolved', mayThrow: true });
  if (ts.isBinaryExpression(node)) {
    const operator = node.operatorToken.kind;
    if (operator === ts.SyntaxKind.CommaToken || operator === ts.SyntaxKind.EqualsToken) return result([input(node.right)],
      { requiresCfg: operator === ts.SyntaxKind.EqualsToken });
    const assignment = operator >= ts.SyntaxKind.FirstAssignment && operator <= ts.SyntaxKind.LastAssignment;
    return result([input(node.left), input(node.right)], { mayThrow: true, requiresCfg: assignment });
  }
  if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) return result([input(node.operand)],
    { mayThrow: true, requiresCfg: [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator) });
  if (ts.isConditionalExpression(node)) return result([
    input(node.whenTrue, 'flowsTo', 'modeled', node.condition), input(node.whenFalse, 'flowsTo', 'modeled', node.condition)
  ]);
  if (ts.isVoidExpression(node)) return result();
  if (ts.isTypeOfExpression(node)) return result([input(node.expression, 'flowsTo', 'modeled')]);
  // Delete consumes a reference, not the selected property's stored value. Its
  // Boolean result and mutation effects stay unknown until a heap model owns them.
  if (ts.isDeleteExpression(node)) return result([],
    { reason: 'delete_result_and_heap_effects_unresolved', mayThrow: true });
  if (ts.isCommaListExpression(node)) return result(node.elements.length ? [input(node.elements.at(-1))] : []);
  // Separate owners supply binding, invocation, storage and creation channels.
  if (ts.isIdentifier(node) || ts.isLiteralExpression(node) || ts.isTemplateLiteralToken(node)
    || ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isTaggedTemplateExpression(node)
    || ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)
    || ts.isFunctionLike(node) || ts.isClassExpression(node)
    || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword,
      ts.SyntaxKind.ThisKeyword, ts.SyntaxKind.SuperKeyword].includes(node.kind)) return result();
  if (ts.isExpressionNode(node)) return result([], { reason: 'unsupported_value_dependency:' + ts.SyntaxKind[node.kind] });
  return null;
};
