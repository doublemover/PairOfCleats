/** Small parse-shape descriptors, not a second CFG. Expressions retain their
 * evaluation phase/conditionality while binding identifiers remain bindings. */
export const parameterEvaluationExpressions = params => {
  const output = [], stack = (params || []).slice(0, 4096).map(node => ({ node, parent: null, conditional: false })).reverse();
  const push = frame => { if (stack.length < 10000) stack.push(frame); else partial = true; };
  const children = (values, visit) => {
    const admitted = Math.min(values.length, 10000 - stack.length);
    if (admitted < values.length) partial = true;
    for (let i = admitted - 1; i >= 0; i--) visit(values[i]);
  };
  let visited = 0, partial = (params?.length || 0) > 4096;
  while (stack.length) {
    if (++visited > 10000 || output.length >= 4096) { partial = true; break; }
    const frame = stack.pop(), { node, conditional } = frame;
    if (!node) continue;
    if (frame.expression) { output.push({ node, parent: frame.parent, evaluationPhase: 'parameter-initialization', conditional }); continue; }
    if (node.type === 'AssignmentPattern') {
      push({ node: node.left, conditional });
      push({ node: node.right, parent: node, expression: true, conditional: true });
    } else if (node.type === 'ObjectPattern') {
      children(node.properties, property => {
        if (!['Property', 'ObjectProperty', 'RestElement'].includes(property?.type)) { partial = true; return; }
        push({ node: property.value || property.argument, conditional });
        if (property.computed && property.key) push({ node: property.key, parent: property, expression: true, conditional });
      });
    } else if (node.type === 'ArrayPattern') {
      children(node.elements, child => push({ node: child, conditional }));
    } else if (node.type === 'RestElement') push({ node: node.argument, conditional });
    else if (node.type !== 'Identifier') partial = true;
  }
  return { expressions: output, partial };
};

export const callableEvaluationChildren = (node, parent) => {
  const parameters = parameterEvaluationExpressions(node.params);
  const definition = node.computed && node.key ? [{ node: node.key, parent: node, evaluationPhase: 'definition-evaluation', conditional: false }] : [];
  return { definition, parameters: parameters.expressions, body: node.body ? { node: node.body, parent: node, evaluationPhase: 'invocation-body', conditional: false } : null,
    implicitValueReturn: node.type === 'ArrowFunctionExpression' && node.body?.type !== 'BlockStatement',
    unsupported: Boolean(node.decorators?.length || parent?.decorators?.length), partialParameters: parameters.partial };
};
