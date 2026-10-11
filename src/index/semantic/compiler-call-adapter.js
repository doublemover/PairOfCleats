/** Source-backed Function.call/apply/bind adapters. These are may candidates:
 * method replacement, escaping bound values and runtime receiver coercion remain open. */
export const compilerCallAdapter = ({ ts, checker, node, isDefaultLibrary }) => {
  if (!node || !ts.isCallExpression(node) || typeof isDefaultLibrary !== 'function') return null;
  const reasons = new Set();
  const unwrap = value => {
    while (value && (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) || ts.isNonNullExpression(value))) value = value.expression;
    return value;
  };
  const intrinsic = (call, names) => {
    if (!ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression) || !names.includes(call.expression.name.text)) return null;
    const declaration = checker.getResolvedSignature(call)?.declaration;
    if (!declaration || !isDefaultLibrary(declaration.getSourceFile())
      || !['Function', 'CallableFunction', 'NewableFunction'].includes(declaration.parent?.name?.text)) return null;
    return call.expression.name.text;
  };
  const bound = (input, seen = new Set()) => {
    const value = unwrap(input);
    if (!value || seen.has(value) || seen.size >= 16) {
      reasons.add('bound_callable_alias_budget_or_cycle'); return null;
    }
    seen = new Set(seen).add(value);
    if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression) && value.expression.name.text === 'bind') {
      const previous = bound(value.expression.expression, seen);
      if (!previous && !intrinsic(value, ['bind'])) return null;
      const prefix = [...(previous?.arguments || []), ...value.arguments.slice(1)];
      reasons.add('bound_callable_receiver_coercion_escape_and_method_replacement_unobserved');
      return { callee: previous?.callee || value.expression.expression,
        receiver: previous ? previous.receiver : value.arguments[0] || null,
        arguments: prefix.slice(0, 32),
        unknownInputs: [...(previous?.unknownInputs || []), value.expression, ...value.arguments].slice(0, 64),
        hasSpread: Boolean(previous?.hasSpread || prefix.some(ts.isSpreadElement) || prefix.length > 32) };
    }
    if (!ts.isIdentifier(value)) return null;
    const declaration = checker.getSymbolAtLocation(value)?.valueDeclaration;
    if (!declaration || !ts.isVariableDeclaration(declaration) || !(declaration.parent.flags & ts.NodeFlags.Const)
      || declaration.getSourceFile() !== node.getSourceFile()) return null;
    return bound(declaration.initializer, seen);
  };
  let kind = intrinsic(node, ['call', 'apply']);
  // A source-proven native bound function can have `any` checker type (non-strict
  // bind signatures). Its modeled Function receiver remains available as evidence.
  if (!kind && ts.isPropertyAccessExpression(node.expression)
    && ['call', 'apply'].includes(node.expression.name.text) && bound(node.expression.expression)) kind = node.expression.name.text;
  const binding = bound(kind ? node.expression.expression : node.expression);
  if (!kind && !binding) return null;
  let args = [...node.arguments], hasSpread = args.some(ts.isSpreadElement);
  if (kind === 'call') args = args.slice(1);
  if (kind === 'apply') {
    const array = unwrap(args[1]);
    if (!array || array.kind === ts.SyntaxKind.NullKeyword) args = [];
    else if (ts.isArrayLiteralExpression(array) && !array.elements.some(value => ts.isSpreadElement(value) || ts.isOmittedExpression(value))) args = [...array.elements];
    else { args = [array]; hasSpread = true; reasons.add('apply_arraylike_positions_unresolved'); }
  }
  const argumentsList = [...(binding?.arguments || []), ...args];
  if (argumentsList.length > 32) reasons.add('call_adapter_argument_budget');
  reasons.add('function_invocation_adapter_runtime_effects_unobserved');
  return { callee: binding?.callee || node.expression.expression,
    receiver: binding ? binding.receiver : node.arguments[0] || null,
    runtimeArguments: argumentsList.slice(0, 32),
    unknownInputs: [...(binding?.unknownInputs || []), node.expression, ...node.arguments].slice(0, 64),
    hasSpread: Boolean(hasSpread || binding?.hasSpread || argumentsList.length > 32), reasons: [...reasons] };
};
