import { displayDefaults } from './defaults.js';

const resolveLimit = (value, fallback) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Number(value));
};

export const normalizeDisplayLimits = (overrides = {}) => {
  const maxFiles = resolveLimit(overrides.maxFiles, displayDefaults.maxFiles);
  const maxMembers = resolveLimit(overrides.maxMembersPerFile, displayDefaults.maxMembersPerFile);
  const maxEdges = resolveLimit(overrides.maxEdges, displayDefaults.maxEdges);
  return { maxFiles, maxMembersPerFile: maxMembers, maxEdges };
};

export const applyDisplayLimits = (map, overrides) => {
  if (!map || typeof map !== 'object') return { map: map || {}, limits: normalizeDisplayLimits() };
  const limits = normalizeDisplayLimits(overrides);
  const { maxFiles, maxMembersPerFile: maxMembers, maxEdges } = limits;

  const nodes = Array.isArray(map.nodes) ? map.nodes : [];
  const edges = Array.isArray(map.edges) ? map.edges : [];
  const limitedNodes = [];
  let droppedMembers = 0;

  for (const node of nodes.slice(0, maxFiles)) {
    const members = Array.isArray(node.members) ? node.members : [];
    const keptMembers = members.slice(0, maxMembers);
    droppedMembers += Math.max(0, members.length - keptMembers.length);
    limitedNodes.push({ ...node, members: keptMembers });
  }

  const droppedFiles = Math.max(0, nodes.length - limitedNodes.length);
  const fileSet = new Set();
  const memberSet = new Set();

  for (const node of limitedNodes) {
    const fileKey = node.path || node.name || null;
    if (fileKey) fileSet.add(fileKey);
    for (const member of node.members || []) {
      if (member?.id === 0 || member?.id) memberSet.add(String(member.id));
    }
  }

  const filteredEdges = edges.filter((edge) => {
    const fromMember = edge?.from?.member;
    const toMember = edge?.to?.member;
    const fromFile = edge?.from?.file;
    const toFile = edge?.to?.file;
    if (fromMember && !memberSet.has(String(fromMember))) return false;
    if (toMember && !memberSet.has(String(toMember))) return false;
    if (fromFile && !fileSet.has(fromFile)) return false;
    if (toFile && !fileSet.has(toFile)) return false;
    return true;
  });

  const limitedEdges = filteredEdges.length > maxEdges
    ? filteredEdges.slice(0, maxEdges)
    : filteredEdges;
  const droppedEdges = Math.max(0, filteredEdges.length - limitedEdges.length);

  const counts = {
    files: limitedNodes.length,
    members: limitedNodes.reduce((acc, node) => acc + (node.members?.length || 0), 0),
    edges: limitedEdges.length
  };
  const dropped = { files: droppedFiles, members: droppedMembers, edges: droppedEdges };
  const truncated = droppedFiles > 0 || droppedMembers > 0 || droppedEdges > 0;

  const nextMap = {
    ...map,
    nodes: limitedNodes,
    edges: limitedEdges,
    summary: {
      ...(map.summary || {}),
      counts,
      dropped,
      truncated,
      limits
    },
    viewer: {
      ...(map.viewer || {}),
      performance: {
        ...(map.viewer?.performance || {}),
        displayLimits: limits
      }
    }
  };

  return { map: nextMap, limits };
};
