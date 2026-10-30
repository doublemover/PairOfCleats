export const createNativeFlowTree = ({ statements = 8, functions = 1, partitionId = 'sy1:' + 'a'.repeat(64) } = {}) => {
  const nodes = [], reads = { named: 0 };
  const node = (type, children = [], fields = {}) => {
    const value = { id: nodes.length, type, startIndex: 0, endIndex: 1, hasError: false,
      namedChildCount: children.length, childCount: children.length,
      namedChild(index) { reads.named++; return children[index]; }, child(index) { return children[index]; },
      childForFieldName(name) { return fields[name] || null; } };
    nodes.push(value); return value;
  };
  const owners = Array.from({ length: functions }, () => {
    const children = Array.from({ length: statements }, () => node('identifier'));
    const body = node('block', children); return node('function_definition', [body], { body });
  });
  const anchors = new Map(nodes.map(value => [value.id, { partitionId, localId: value.id }]));
  return { collector: { owners, anchors }, nodes, reads, node };
};
