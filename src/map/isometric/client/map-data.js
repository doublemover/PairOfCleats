import { state } from './state.js';

const buildMemberKey = (filePath, name, range) => {
  const start = Number.isFinite(range?.startLine) ? range.startLine : '';
  const end = Number.isFinite(range?.endLine) ? range.endLine : '';
  return `${filePath}::${name || ''}:${start}-${end}`;
};

const buildMemberNameKey = (filePath, name) => `${filePath}::${name || ''}`;

export const initMapData = () => {
  const files = Array.isArray(state.map?.nodes) ? state.map.nodes : [];
  const edges = Array.isArray(state.map?.edges) ? state.map.edges : [];
  const nodeByPath = new Map();
  const nodeById = new Map();
  const memberById = new Map();
  const memberByKey = new Map();
  const fileByMember = new Map();

  for (const node of files) {
    if (node.path) nodeByPath.set(node.path, node);
    if (node.name && !nodeByPath.has(node.name)) nodeByPath.set(node.name, node);
    if (node.id) nodeById.set(node.id, node);
    const members = Array.isArray(node.members) ? node.members : [];
    for (const member of members) {
      if (member?.id) memberById.set(member.id, member);
      const filePath = member?.file || node.path || node.name || '';
      if (member?.id) fileByMember.set(member.id, filePath);
      const rangeKey = buildMemberKey(filePath, member?.name || '', member?.range || {});
      memberByKey.set(rangeKey, member);
      const nameKey = buildMemberNameKey(filePath, member?.name || '');
      if (!memberByKey.has(nameKey)) memberByKey.set(nameKey, member);
    }
  }

  Object.assign(state, {
    files,
    edges,
    nodeByPath,
    nodeById,
    memberById,
    memberByKey,
    fileByMember,
    buildMemberKey,
    buildMemberNameKey
  });
};
