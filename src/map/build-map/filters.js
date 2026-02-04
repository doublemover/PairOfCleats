import { normalizePath, sortBy } from '../utils.js';

const DEFAULT_INCLUDE = ['imports', 'calls', 'usages', 'dataflow', 'exports'];

export const resolveFocus = (options) => {
  const scope = typeof options.scope === 'string' ? options.scope.toLowerCase() : 'repo';
  const focus = typeof options.focus === 'string' ? options.focus.trim() : '';
  return { scope, focus };
};

export const normalizeIncludeList = (include) => {
  if (!include) return DEFAULT_INCLUDE.slice();
  const list = Array.isArray(include) ? include : String(include).split(',');
  const normalized = list
    .map((entry) => String(entry).trim().toLowerCase())
    .filter(Boolean);
  return normalized.length ? normalized : DEFAULT_INCLUDE.slice();
};

export const createScopeFilters = ({
  scope,
  focus,
  edgeIteratorFactory,
  normalizeMemberId
}) => {
  const normalizedFocus = typeof focus === 'string' ? normalizePath(focus) : '';
  if (scope === 'member') {
    const focusId = normalizeMemberId(normalizedFocus || focus);
    if (!focusId) {
      return {
        nodeFilter: () => null,
        edgeFilter: () => false,
        memberFocusId: null,
        memberSet: new Set()
      };
    }
    const memberSet = new Set([focusId]);
    for (const edge of edgeIteratorFactory()) {
      const fromMember = normalizeMemberId(edge.from?.member);
      const toMember = normalizeMemberId(edge.to?.member);
      if (fromMember === focusId || toMember === focusId) {
        if (fromMember) memberSet.add(fromMember);
        if (toMember) memberSet.add(toMember);
      }
    }
    const nodeFilter = (node) => {
      const members = Array.isArray(node.members) ? node.members : [];
      if (!members.length) return null;
      let kept = null;
      for (const member of members) {
        const id = normalizeMemberId(member.id);
        if (id && memberSet.has(id)) {
          if (!kept) kept = [];
          kept.push(member);
        }
      }
      if (!kept || !kept.length) return null;
      if (kept.length === members.length) return node;
      return { ...node, members: kept };
    };
    const edgeFilter = (edge) => {
      const fromMember = normalizeMemberId(edge.from?.member);
      const toMember = normalizeMemberId(edge.to?.member);
      return fromMember === focusId || toMember === focusId;
    };
    return {
      nodeFilter,
      edgeFilter,
      memberFocusId: focusId,
      memberSet
    };
  }

  if (scope === 'dir') {
    const base = normalizedFocus.replace(/\/+$/, '');
    const nodeFilter = (node) => {
      if (node.path === base || node.path.startsWith(`${base}/`)) return node;
      return null;
    };
    const edgeFilter = (edge) => {
      const fromFile = edge.from?.file || null;
      const toFile = edge.to?.file || null;
      if (fromFile && !(fromFile === base || fromFile.startsWith(`${base}/`))) return false;
      if (toFile && !(toFile === base || toFile.startsWith(`${base}/`))) return false;
      return true;
    };
    return { nodeFilter, edgeFilter, memberFocusId: null, memberSet: null };
  }

  if (scope === 'file') {
    const nodeFilter = (node) => (node.path === normalizedFocus ? node : null);
    const edgeFilter = (edge) => {
      const fromFile = edge.from?.file || null;
      const toFile = edge.to?.file || null;
      if (fromFile && fromFile !== normalizedFocus) return false;
      if (toFile && toFile !== normalizedFocus) return false;
      return true;
    };
    return { nodeFilter, edgeFilter, memberFocusId: null, memberSet: null };
  }

  return {
    nodeFilter: (node) => node,
    edgeFilter: () => true,
    memberFocusId: null,
    memberSet: null
  };
};

export const createCollapseTransform = ({ collapse, nodes }) => {
  if (!collapse || collapse === 'none') {
    return { nodes, edgeTransform: (edge) => edge };
  }
  if (collapse === 'file') {
    const fileNodes = [];
    for (const node of nodes) {
      fileNodes.push(node.members?.length ? { ...node, members: [] } : node);
    }
    const edgeTransform = (edge) => ({
      ...edge,
      from: edge.from?.file ? { file: edge.from.file } : null,
      to: edge.to?.file ? { file: edge.to.file } : null
    });
    return { nodes: fileNodes, edgeTransform };
  }
  if (collapse === 'dir') {
    const dirNodes = new Map();
    const fileToDir = new Map();
    for (const node of nodes) {
      const parts = normalizePath(node.path).split('/');
      const dir = parts.length > 1 ? parts[0] : parts[0] || 'root';
      fileToDir.set(node.path, dir);
      if (!dirNodes.has(dir)) {
        dirNodes.set(dir, {
          id: dir,
          path: dir,
          name: dir,
          ext: null,
          category: 'dir',
          type: 'file',
          members: []
        });
      }
    }
    const edgeTransform = (edge) => {
      const fromFile = edge.from?.file || null;
      const toFile = edge.to?.file || null;
      const fromDir = fromFile ? fileToDir.get(fromFile) : null;
      const toDir = toFile ? fileToDir.get(toFile) : null;
      return {
        ...edge,
        from: fromDir ? { file: fromDir } : null,
        to: toDir ? { file: toDir } : null
      };
    };
    return { nodes: Array.from(dirNodes.values()), edgeTransform };
  }
  return { nodes, edgeTransform: (edge) => edge };
};

export const applyLimits = ({ nodes, edges, limits, topKByDegree }) => {
  const dropped = { files: 0, members: 0, edges: 0 };
  const limitedNodes = [];
  const maxFiles = limits.maxFiles;
  const maxMembers = limits.maxMembersPerFile;

  let fileList = sortBy(nodes, (node) => node.path);
  if (topKByDegree) {
    const degree = new Map();
    for (const edge of edges) {
      const fromFile = edge.from?.file || null;
      const toFile = edge.to?.file || null;
      if (fromFile) degree.set(fromFile, (degree.get(fromFile) || 0) + 1);
      if (toFile) degree.set(toFile, (degree.get(toFile) || 0) + 1);
    }
    fileList = nodes.slice().sort((a, b) => {
      const scoreA = degree.get(a.path) || 0;
      const scoreB = degree.get(b.path) || 0;
      if (scoreA !== scoreB) return scoreB - scoreA;
      return String(a.path).localeCompare(String(b.path));
    });
  }
  for (const node of fileList.slice(0, maxFiles)) {
    const members = Array.isArray(node.members) ? node.members : [];
    const memberList = sortBy(members, (member) => `${member.name}:${member.range?.startLine || 0}`);
    const keptMembers = memberList.slice(0, maxMembers);
    dropped.members += Math.max(0, memberList.length - keptMembers.length);
    limitedNodes.push({
      ...node,
      members: keptMembers
    });
  }
  dropped.files = Math.max(0, fileList.length - limitedNodes.length);

  const memberSet = new Set();
  const fileSet = new Set();
  for (const node of limitedNodes) {
    fileSet.add(node.path);
    for (const member of node.members || []) {
      memberSet.add(member.id);
    }
  }

  const filteredEdges = edges.filter((edge) => {
    const fromMember = edge.from?.member;
    const toMember = edge.to?.member;
    const fromFile = edge.from?.file;
    const toFile = edge.to?.file;
    if (fromMember && !memberSet.has(fromMember)) return false;
    if (toMember && !memberSet.has(toMember)) return false;
    if (fromFile && !fileSet.has(fromFile)) return false;
    if (toFile && !fileSet.has(toFile)) return false;
    return true;
  });

  let edgeList = filteredEdges;
  if (topKByDegree) {
    edgeList = filteredEdges.slice().sort((a, b) => {
      const fromA = a.from?.member || a.from?.file || '';
      const fromB = b.from?.member || b.from?.file || '';
      if (fromA !== fromB) return String(fromA).localeCompare(String(fromB));
      const toA = a.to?.member || a.to?.file || '';
      const toB = b.to?.member || b.to?.file || '';
      if (toA !== toB) return String(toA).localeCompare(String(toB));
      return String(a.type || '').localeCompare(String(b.type || ''));
    });
  }
  const limitedEdges = edgeList.slice(0, limits.maxEdges);
  if (topKByDegree && edgeList.length > limits.maxEdges) {
    const uniqueEdges = new Set();
    limitedEdges.forEach((edge) => {
      const from = edge.from?.member || edge.from?.file || '';
      const to = edge.to?.member || edge.to?.file || '';
      uniqueEdges.add(`${edge.type}:${from}->${to}:${edge.label || ''}`);
    });
  }
  dropped.edges = Math.max(0, edgeList.length - limitedEdges.length);

  return { nodes: limitedNodes, edges: limitedEdges, dropped };
};

export const applyScopeFilter = ({ nodes, edges, scope, focus }) => {
  if (scope === 'repo' || !focus) return { nodes, edges };

  const normalizedFocus = normalizePath(focus);
  if (scope === 'dir') {
    const base = normalizedFocus.replace(/\/+$/, '');
    const filteredNodes = nodes.filter((node) => (
      node.path === base || node.path.startsWith(`${base}/`)
    ));
    const fileSet = new Set(filteredNodes.map((node) => node.path));
    const filteredEdges = edges.filter((edge) => {
      const fromFile = edge.from?.file || null;
      const toFile = edge.to?.file || null;
      if (fromFile && !fileSet.has(fromFile)) return false;
      if (toFile && !fileSet.has(toFile)) return false;
      return true;
    });
    return { nodes: filteredNodes, edges: filteredEdges };
  }

  if (scope === 'file') {
    const file = normalizedFocus;
    const filteredNodes = nodes.filter((node) => node.path === file);
    const memberIds = new Set();
    for (const node of filteredNodes) {
      for (const member of node.members || []) {
        memberIds.add(member.id);
      }
    }
    const filteredEdges = edges.filter((edge) => {
      const fromMember = edge.from?.member || null;
      const toMember = edge.to?.member || null;
      const fromFile = edge.from?.file || null;
      const toFile = edge.to?.file || null;
      if (fromFile && fromFile !== file) return false;
      if (toFile && toFile !== file) return false;
      if (fromMember && !memberIds.has(fromMember)) return false;
      if (toMember && !memberIds.has(toMember)) return false;
      return true;
    });
    return { nodes: filteredNodes, edges: filteredEdges };
  }

  if (scope === 'member') {
    const memberId = focus;
    const filteredNodes = nodes
      .map((node) => {
        const members = (node.members || []).filter((member) => member.id === memberId);
        if (!members.length) return null;
        return { ...node, members };
      })
      .filter(Boolean);
    const edgeMatches = edges.filter((edge) => {
      const from = edge.from?.member || null;
      const to = edge.to?.member || null;
      return from === memberId || to === memberId;
    });
    if (edgeMatches.length) {
      const set = new Set([memberId]);
      for (const edge of edgeMatches) {
        if (edge.from?.member) set.add(edge.from.member);
        if (edge.to?.member) set.add(edge.to.member);
      }
      const expandedNodes = nodes
        .map((node) => {
          const members = (node.members || []).filter((member) => set.has(member.id));
          if (!members.length) return null;
          return { ...node, members };
        })
        .filter(Boolean);
      return { nodes: expandedNodes, edges: edgeMatches };
    }

    return { nodes: filteredNodes, edges: edgeMatches };
  }

  return { nodes, edges };
};

export const applyCollapse = ({ nodes, edges, collapse }) => {
  if (!collapse || collapse === 'none') return { nodes, edges };
  if (collapse === 'file') {
    const fileNodes = [];
    for (const node of nodes) {
      fileNodes.push(node.members?.length ? { ...node, members: [] } : node);
    }
    const collapsedEdges = [];
    for (const edge of edges) {
      collapsedEdges.push({
        ...edge,
        from: edge.from?.file ? { file: edge.from.file } : null,
        to: edge.to?.file ? { file: edge.to.file } : null
      });
    }
    return { nodes: fileNodes, edges: collapsedEdges };
  }
  if (collapse === 'dir') {
    const dirNodes = new Map();
    const fileToDir = new Map();
    for (const node of nodes) {
      const parts = normalizePath(node.path).split('/');
      const dir = parts.length > 1 ? parts[0] : parts[0] || 'root';
      fileToDir.set(node.path, dir);
      if (!dirNodes.has(dir)) {
        dirNodes.set(dir, {
          id: dir,
          path: dir,
          name: dir,
          ext: null,
          category: 'dir',
          type: 'file',
          members: []
        });
      }
    }
    const collapsedEdges = [];
    for (const edge of edges) {
      const fromFile = edge.from?.file || null;
      const toFile = edge.to?.file || null;
      const fromDir = fromFile ? fileToDir.get(fromFile) : null;
      const toDir = toFile ? fileToDir.get(toFile) : null;
      collapsedEdges.push({
        ...edge,
        from: fromDir ? { file: fromDir } : null,
        to: toDir ? { file: toDir } : null
      });
    }
    return { nodes: Array.from(dirNodes.values()), edges: collapsedEdges };
  }
  return { nodes, edges };
};
