export const COMMON_NAME_NODE_TYPES = new Set([
  'identifier',
  'type_identifier',
  'scoped_identifier',
  'qualified_identifier',
  'field_identifier',
  'simple_identifier',
  'namespace_identifier'
]);

export const getNamedChildCount = (node) => {
  if (!node) return 0;
  if (Number.isFinite(node.namedChildCount)) return node.namedChildCount;
  return Array.isArray(node.namedChildren) ? node.namedChildren.length : 0;
};

export const getNamedChild = (node, index) => {
  if (!node) return null;
  if (typeof node.namedChild === 'function') return node.namedChild(index);
  if (Array.isArray(node.namedChildren)) return node.namedChildren[index] || null;
  return null;
};

export function findDescendantByType(root, types, maxDepth = 6) {
  if (!root) return null;
  const stack = [{ node: root, depth: 0 }];
  while (stack.length) {
    const { node, depth } = stack.pop();
    if (!node) continue;
    if (types.has(node.type)) return node;
    if (depth >= maxDepth) continue;
    const count = getNamedChildCount(node);
    for (let i = count - 1; i >= 0; i -= 1) {
      stack.push({ node: getNamedChild(node, i), depth: depth + 1 });
    }
  }
  return null;
}
