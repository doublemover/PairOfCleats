const callableTypes = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression',
  'ClassMethod', 'ClassPrivateMethod', 'ObjectMethod']);
const enclosingDeclarations = new Set(['VariableDeclarator', 'AssignmentExpression', 'MethodDefinition',
  'ClassProperty', 'ClassPrivateProperty', 'PropertyDefinition', 'ExportNamedDeclaration', 'ExportDefaultDeclaration']);
const span = node => {
  const start = node?.start ?? node?.range?.[0], end = node?.end ?? node?.range?.[1];
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end > start
    ? Object.freeze([start, end]) : null;
};

/** Borrow an existing relation parser's nodes. This owner never reparses source,
 * follows parent pointers, or retains AST handles in the emitted plain facts. */
export const createReturnCallEvidence = (ast, { sourceOwned = false } = {}) => {
  const returned = new WeakMap();
  const enabled = sourceOwned === true && Boolean(ast) && !ast.errors?.length;
  const enter = (node, parent, inheritedOwner = null) => {
    let owner = inheritedOwner;
    if (callableTypes.has(node.type)) {
      const ranges = [span(node)];
      if (enclosingDeclarations.has(parent?.type)) ranges.push(span(parent));
      owner = { ranges: Object.freeze(ranges.filter(Boolean)), async: node.async === true,
        generator: node.generator === true };
    }
    if (!enabled || !owner) return owner;
    let expression = node.type === 'ReturnStatement' ? node.argument
      : node.type === 'ArrowFunctionExpression' && node.body?.type !== 'BlockStatement' ? node.body : null;
    if (!expression) return owner;
    // Parentheses preserve the value. Assertions, optional calls, sequence and
    // member expressions do not establish the same callee-result contract.
    while (expression?.type === 'ParenthesizedExpression') expression = expression.expression;
    let awaited = false;
    if (expression?.type === 'AwaitExpression') { awaited = true; expression = expression.argument; }
    while (expression?.type === 'ParenthesizedExpression') expression = expression.expression;
    if (!expression || !['CallExpression', 'NewExpression'].includes(expression.type) || expression.optional) return owner;
    const expressionSpan = span(expression);
    if (!expressionSpan || !owner.ranges.length) return owner;
    returned.set(expression, Object.freeze({ v: 1, kind: expression.type === 'NewExpression' ? 'construct' : 'call',
      ownerRanges: owner.ranges, expression: expressionSpan, awaited, async: owner.async, generator: owner.generator }));
    return owner;
  };
  return { enter, get: node => returned.get(node) || null };
};
