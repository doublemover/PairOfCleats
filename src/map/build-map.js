import fs from 'node:fs';
import path from 'node:path';
import { loadChunkMeta, readJsonFile } from '../shared/artifact-io.js';
import { sha1 } from '../shared/hash.js';
import { stableStringify } from '../shared/stable-json.js';
import {
  DEFAULT_LEGEND,
  DEFAULT_LIMITS,
  MAP_MODEL_VERSION,
  VIEWER_DEFAULTS
} from './constants.js';
import {
  basename,
  classifyFilePath,
  extension,
  normalizePath,
  sortBy,
  unique
} from './utils.js';

const ANON_NAMES = new Set(['(anonymous)', '<anonymous>', 'anonymous']);
const DEFAULT_INCLUDE = ['imports', 'calls', 'usages', 'dataflow', 'exports'];

const readJsonOptional = (filePath, warnings) => {
  try {
    if (!fs.existsSync(filePath)) return null;
    return readJsonFile(filePath);
  } catch (err) {
    const detail = err?.message ? ` (${err.message})` : '';
    warnings.push(`Failed to read ${filePath}${detail}`);
    return null;
  }
};

const hydrateChunkMeta = (chunks, fileMetaRaw) => {
  if (!Array.isArray(chunks)) return [];
  if (!Array.isArray(fileMetaRaw)) return chunks;
  const fileMetaById = new Map();
  for (const entry of fileMetaRaw) {
    if (!entry || entry.id == null) continue;
    fileMetaById.set(entry.id, entry);
  }
  for (const chunk of chunks) {
    if (!chunk || (chunk.file && chunk.ext)) continue;
    const meta = fileMetaById.get(chunk.fileId);
    if (!meta) continue;
    if (!chunk.file) chunk.file = meta.file;
    if (!chunk.ext) chunk.ext = meta.ext;
  }
  return chunks;
};

const normalizeArray = (value) => {
  if (!Array.isArray(value)) return null;
  const filtered = value
    .filter((entry) => entry !== null && entry !== undefined && entry !== '')
    .map((entry) => String(entry))
    .filter(Boolean);
  return filtered.length ? filtered : null;
};

const normalizeModifiers = (modifiers) => {
  if (!modifiers || typeof modifiers !== 'object') return null;
  return { ...modifiers };
};

const normalizeControlFlow = (controlFlow) => {
  if (!controlFlow || typeof controlFlow !== 'object') return null;
  return { ...controlFlow };
};

const normalizeDataflow = (dataflow) => {
  if (!dataflow || typeof dataflow !== 'object') return null;
  const reads = normalizeArray(dataflow.reads);
  const writes = normalizeArray(dataflow.writes);
  const mutations = normalizeArray(dataflow.mutations);
  const aliases = normalizeArray(dataflow.aliases);
  if (!reads && !writes && !mutations && !aliases) return null;
  return {
    reads,
    writes,
    mutations,
    aliases
  };
};

const buildSymbolId = ({ file, name, kind, startLine, chunkId }) => {
  const safeFile = normalizePath(file || '');
  const safeName = String(name || '').trim();
  const lowered = safeName.toLowerCase();
  if (safeName && !ANON_NAMES.has(lowered)) return `${safeFile}::${safeName}`;
  if (chunkId) return `${safeFile}::${chunkId}`;
  const suffix = Number.isFinite(startLine) ? startLine : 0;
  const kindTag = kind ? String(kind) : 'symbol';
  return `${safeFile}::${kindTag}:${suffix}`;
};

const buildPortId = (symbolId) => `p_${sha1(symbolId).slice(0, 12)}`;

const memberTypeFromKind = (kind) => {
  const value = typeof kind === 'string' ? kind.toLowerCase() : '';
  if (value.includes('class') || value.includes('interface') || value.includes('struct')) return 'class';
  if (value.includes('function') || value.includes('method') || value.includes('ctor')) return 'function';
  return 'symbol';
};

const upsertMember = (membersByFile, memberById, file, id, base) => {
  const list = membersByFile.get(file) || [];
  let member = memberById.get(id);
  if (!member) {
    member = {
      id,
      file,
      name: base.name || '',
      kind: base.kind || null,
      type: memberTypeFromKind(base.kind),
      signature: base.signature || null,
      params: base.params || null,
      returns: base.returns || null,
      modifiers: base.modifiers || null,
      dataflow: base.dataflow || null,
      controlFlow: base.controlFlow || null,
      exported: base.exported ?? null,
      range: base.range || { startLine: null, endLine: null },
      port: buildPortId(id)
    };
    list.push(member);
    membersByFile.set(file, list);
    memberById.set(id, member);
  } else {
    if (!member.file) member.file = file;
    if (!member.name && base.name) member.name = base.name;
    if (!member.kind && base.kind) member.kind = base.kind;
    if (!member.signature && base.signature) member.signature = base.signature;
    if (!member.params && base.params) member.params = base.params;
    if (!member.returns && base.returns) member.returns = base.returns;
    if (!member.modifiers && base.modifiers) member.modifiers = base.modifiers;
    if (!member.dataflow && base.dataflow) member.dataflow = base.dataflow;
    if (!member.controlFlow && base.controlFlow) member.controlFlow = base.controlFlow;
    if (member.exported == null && base.exported != null) member.exported = base.exported;
    if (base.range) {
      const range = member.range || { startLine: null, endLine: null };
      if (range.startLine == null && base.range.startLine != null) range.startLine = base.range.startLine;
      if (range.endLine == null && base.range.endLine != null) range.endLine = base.range.endLine;
      member.range = range;
    }
    member.type = memberTypeFromKind(member.kind);
  }
  return member;
};

const resolveFocus = (options) => {
  const scope = typeof options.scope === 'string' ? options.scope.toLowerCase() : 'repo';
  const focus = typeof options.focus === 'string' ? options.focus.trim() : '';
  return { scope, focus };
};

const normalizeIncludeList = (include) => {
  if (!include) return DEFAULT_INCLUDE.slice();
  const list = Array.isArray(include) ? include : String(include).split(',');
  const normalized = list
    .map((entry) => String(entry).trim().toLowerCase())
    .filter(Boolean);
  return normalized.length ? normalized : DEFAULT_INCLUDE.slice();
};

const buildMemberIndex = (memberById) => {
  const byName = new Map();
  for (const member of memberById.values()) {
    if (!member?.name) continue;
    const key = member.name;
    const list = byName.get(key) || [];
    list.push(member);
    byName.set(key, list);
  }
  return byName;
};

const resolveMemberByName = (memberIndex, name, fileHint) => {
  const list = memberIndex.get(name) || [];
  if (!list.length) return null;
  if (fileHint) {
    const match = list.find((entry) => entry.file === fileHint);
    if (match) return match;
  }
  if (list.length === 1) return list[0];
  const sorted = sortBy(list, (entry) => `${entry.file || ''}:${entry.range?.startLine || 0}`);
  return sorted[0];
};

const buildEdgesFromGraph = ({ graph, type, memberById }) => {
  if (!graph || !Array.isArray(graph.nodes)) return [];
  const edges = [];
  for (const node of graph.nodes) {
    if (!node?.id || !Array.isArray(node.out)) continue;
    for (const target of node.out) {
      if (!target) continue;
      if (!memberById.has(node.id) || !memberById.has(target)) continue;
      edges.push({
        type,
        from: { member: node.id },
        to: { member: target },
        label: null
      });
    }
  }
  return edges;
};

const buildEdgesFromCalls = ({ chunkMeta, memberIndex, memberById }) => {
  const edges = [];
  for (const chunk of chunkMeta || []) {
    if (!chunk?.file || !chunk?.name) continue;
    const sourceId = buildSymbolId({
      file: chunk.file,
      name: chunk.name,
      kind: chunk.kind,
      startLine: chunk.startLine,
      chunkId: chunk.metaV2?.chunkId || null
    });
    if (!memberById.has(sourceId)) continue;
    const relations = chunk.codeRelations || {};
    if (!Array.isArray(relations.calls)) continue;
    for (const entry of relations.calls) {
      const targetName = Array.isArray(entry) ? entry[1] : null;
      if (!targetName) continue;
      const targetMember = resolveMemberByName(memberIndex, targetName, chunk.file);
      if (!targetMember) continue;
      edges.push({
        type: 'call',
        from: { member: sourceId },
        to: { member: targetMember.id },
        label: null
      });
    }
  }
  return edges;
};

const buildEdgesFromUsage = ({ chunkMeta, memberIndex, memberById }) => {
  const edges = [];
  for (const chunk of chunkMeta || []) {
    if (!chunk?.file || !chunk?.name) continue;
    const sourceId = buildSymbolId({
      file: chunk.file,
      name: chunk.name,
      kind: chunk.kind,
      startLine: chunk.startLine,
      chunkId: chunk.metaV2?.chunkId || null
    });
    if (!memberById.has(sourceId)) continue;
    const relations = chunk.codeRelations || {};
    if (!Array.isArray(relations.usages)) continue;
    for (const usage of relations.usages) {
      const targetMember = resolveMemberByName(memberIndex, usage, chunk.file);
      if (!targetMember) continue;
      edges.push({
        type: 'usage',
        from: { member: sourceId },
        to: { member: targetMember.id },
        label: null
      });
    }
  }
  return edges;
};

const buildEdgesFromCallSummaries = ({ chunkMeta, memberById }) => {
  const edges = [];
  for (const chunk of chunkMeta || []) {
    const meta = chunk?.metaV2;
    if (!chunk?.file || !chunk?.name || !meta?.relations?.callSummaries) continue;
    const sourceId = buildSymbolId({
      file: chunk.file,
      name: chunk.name,
      kind: chunk.kind,
      startLine: chunk.startLine,
      chunkId: meta.chunkId || null
    });
    if (!memberById.has(sourceId)) continue;
    for (const summary of meta.relations.callSummaries) {
      const targetId = summary?.file && summary?.target
        ? `${normalizePath(summary.file)}::${summary.target}`
        : null;
      if (!targetId || !memberById.has(targetId)) continue;
      const args = summary.argMap ? Object.keys(summary.argMap) : [];
      const argLabel = args.length ? `args:${args.slice(0, 3).join(',')}` : null;
      edges.push({
        type: 'dataflow',
        from: { member: sourceId },
        to: { member: targetId },
        label: argLabel
      });
      if (Array.isArray(summary.returnTypes) && summary.returnTypes.length) {
        edges.push({
          type: 'dataflow',
          from: { member: targetId },
          to: { member: sourceId },
          label: 'return'
        });
      }
    }
  }
  return edges;
};

const buildImportEdges = ({ fileRelations, fileSet }) => {
  if (!Array.isArray(fileRelations)) return [];
  const edges = [];
  for (const entry of fileRelations) {
    if (!entry?.file) continue;
    if (fileSet && !fileSet.has(entry.file)) continue;
    const imports = Array.isArray(entry.relations?.importLinks)
      ? entry.relations.importLinks
      : [];
    for (const target of imports) {
      if (!target) continue;
      if (fileSet && !fileSet.has(target)) continue;
      edges.push({
        type: 'import',
        from: { file: entry.file },
        to: { file: target },
        label: null
      });
    }
  }
  return edges;
};

const buildExportEdges = ({ membersByFile }) => {
  const edges = [];
  for (const [file, members] of membersByFile.entries()) {
    for (const member of members || []) {
      if (member.exported !== true) continue;
      edges.push({
        type: 'export',
        from: { file },
        to: { member: member.id },
        label: member.name || null
      });
    }
  }
  return edges;
};

const buildAliasEdges = ({ membersByFile }) => {
  const edges = [];
  for (const [file, members] of membersByFile.entries()) {
    for (const member of members || []) {
      const aliases = member.dataflow?.aliases || null;
      if (!Array.isArray(aliases) || !aliases.length) continue;
      for (const alias of aliases.slice(0, 3)) {
        if (!alias) continue;
        edges.push({
          type: 'alias',
          from: { member: member.id },
          to: { member: member.id },
          label: `alias:${alias}`,
          meta: { file }
        });
      }
    }
  }
  return edges;
};

const applyLimits = ({ nodes, edges, limits, topKByDegree }) => {
  const dropped = { files: 0, members: 0, edges: 0 };
  const limitedNodes = [];
  const maxFiles = limits.maxFiles;
  const maxMembers = limits.maxMembersPerFile;

  let fileList = sortBy(nodes, (node) => node.path);
  if (topKByDegree) {
    const degree = new Map();
    for (const edge of edges) {
      const fromFile = edge.from?.file || edge.from?.member?.split('::')[0] || null;
      const toFile = edge.to?.file || edge.to?.member?.split('::')[0] || null;
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

  const edgeList = sortBy(filteredEdges, (edge) => {
    const from = edge.from?.member || edge.from?.file || '';
    const to = edge.to?.member || edge.to?.file || '';
    return `${edge.type}:${from}->${to}:${edge.label || ''}`;
  });
  let limitedEdges = edgeList;
  if (edgeList.length > limits.maxEdges) {
    const byType = new Map();
    for (const edge of edgeList) {
      const list = byType.get(edge.type) || [];
      list.push(edge);
      byType.set(edge.type, list);
    }
    const types = Array.from(byType.keys()).sort();
    const allocations = new Map();
    let remaining = limits.maxEdges;
    for (const type of types) {
      const list = byType.get(type) || [];
      const share = Math.floor((limits.maxEdges * list.length) / edgeList.length);
      const count = Math.min(list.length, share);
      allocations.set(type, count);
      remaining -= count;
    }
    for (const type of types) {
      if (remaining <= 0) break;
      const list = byType.get(type) || [];
      const current = allocations.get(type) || 0;
      if (current === 0 && list.length > 0) {
        allocations.set(type, 1);
        remaining -= 1;
      }
    }
    while (remaining > 0) {
      let progressed = false;
      for (const type of types) {
        if (remaining <= 0) break;
        const list = byType.get(type) || [];
        const current = allocations.get(type) || 0;
        if (current < list.length) {
          allocations.set(type, current + 1);
          remaining -= 1;
          progressed = true;
        }
      }
      if (!progressed) break;
    }
    limitedEdges = [];
    for (const type of types) {
      const list = byType.get(type) || [];
      const count = allocations.get(type) || 0;
      limitedEdges.push(...list.slice(0, count));
    }
    limitedEdges = sortBy(limitedEdges, (edge) => {
      const from = edge.from?.member || edge.from?.file || '';
      const to = edge.to?.member || edge.to?.file || '';
      return `${edge.type}:${from}->${to}:${edge.label || ''}`;
    });
  }
  dropped.edges = Math.max(0, edgeList.length - limitedEdges.length);

  return { nodes: limitedNodes, edges: limitedEdges, dropped };
};

const buildFileNodes = (membersByFile) => {
  const nodes = [];
  for (const [file, members] of membersByFile.entries()) {
    const list = sortBy(members || [], (member) => `${member.name}:${member.range?.startLine || 0}`);
    nodes.push({
      id: file,
      path: file,
      name: basename(file),
      ext: extension(file) || null,
      category: classifyFilePath(file),
      type: 'file',
      members: list
    });
  }
  return nodes;
};

const applyScopeFilter = ({ nodes, edges, scope, focus }) => {
  if (scope === 'repo' || !focus) return { nodes, edges };

  const normalizedFocus = normalizePath(focus);
  if (scope === 'dir') {
    const filteredNodes = nodes.filter((node) => node.path.startsWith(normalizedFocus));
    const fileSet = new Set(filteredNodes.map((node) => node.path));
    const filteredEdges = edges.filter((edge) => {
      const fromFile = edge.from?.file || null;
      const toFile = edge.to?.file || null;
      const fromMember = edge.from?.member || null;
      const toMember = edge.to?.member || null;
      if (fromFile && !fileSet.has(fromFile)) return false;
      if (toFile && !fileSet.has(toFile)) return false;
      if (fromMember) {
        const memberFile = fromMember.split('::')[0];
        if (!fileSet.has(memberFile)) return false;
      }
      if (toMember) {
        const memberFile = toMember.split('::')[0];
        if (!fileSet.has(memberFile)) return false;
      }
      return true;
    });
    return { nodes: filteredNodes, edges: filteredEdges };
  }

  if (scope === 'file') {
    const filteredNodes = nodes.filter((node) => node.path === normalizedFocus);
    const filteredEdges = edges.filter((edge) => {
      const fromFile = edge.from?.file || null;
      const toFile = edge.to?.file || null;
      const fromMember = edge.from?.member || null;
      const toMember = edge.to?.member || null;
      if (fromFile && fromFile !== normalizedFocus) return false;
      if (toFile && toFile !== normalizedFocus) return false;
      if (fromMember && !fromMember.startsWith(normalizedFocus + '::')) return false;
      if (toMember && !toMember.startsWith(normalizedFocus + '::')) return false;
      return true;
    });
    return { nodes: filteredNodes, edges: filteredEdges };
  }

  if (scope === 'symbol') {
    let symbolId = normalizedFocus.includes('::')
      ? normalizedFocus
      : null;
    if (!symbolId) {
      const matches = [];
      for (const node of nodes) {
        for (const member of node.members || []) {
          if (member.name === normalizedFocus) matches.push(member.id);
        }
      }
      if (matches.length) {
        symbolId = sortBy(matches, (entry) => entry)[0];
      }
    }
    const allowedMembers = new Set();
    if (symbolId) allowedMembers.add(symbolId);
    const edgeMatches = edges.filter((edge) => {
      const fromMember = edge.from?.member || null;
      const toMember = edge.to?.member || null;
      if (symbolId && (fromMember === symbolId || toMember === symbolId)) {
        if (fromMember) allowedMembers.add(fromMember);
        if (toMember) allowedMembers.add(toMember);
        return true;
      }
      return false;
    });

    const filteredNodes = nodes
      .map((node) => {
        const members = (node.members || []).filter((member) => allowedMembers.has(member.id));
        if (!members.length) return null;
        return { ...node, members };
      })
      .filter(Boolean);
    return { nodes: filteredNodes, edges: edgeMatches };
  }

  return { nodes, edges };
};

const applyCollapse = ({ nodes, edges, collapse }) => {
  if (!collapse || collapse === 'none') return { nodes, edges };
  if (collapse === 'file') {
    const fileNodes = nodes.map((node) => ({ ...node, members: [] }));
    const collapsedEdges = edges.map((edge) => ({
      ...edge,
      from: edge.from?.file
        ? { file: edge.from.file }
        : { file: edge.from?.member?.split('::')[0] || null },
      to: edge.to?.file
        ? { file: edge.to.file }
        : { file: edge.to?.member?.split('::')[0] || null }
    }));
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
    const collapsedEdges = edges.map((edge) => {
      const fromFile = edge.from?.file || edge.from?.member?.split('::')[0] || null;
      const toFile = edge.to?.file || edge.to?.member?.split('::')[0] || null;
      return {
        ...edge,
        from: { file: fromFile ? fileToDir.get(fromFile) || fromFile : null },
        to: { file: toFile ? fileToDir.get(toFile) || toFile : null }
      };
    });
    return { nodes: Array.from(dirNodes.values()), edges: collapsedEdges };
  }
  return { nodes, edges };
};

export function buildCodeMap({ repoRoot, indexDir, options = {} }) {
  const warnings = [];
  const includes = normalizeIncludeList(options.include);
  const limits = {
    maxFiles: Number.isFinite(Number(options.maxFiles))
      ? Math.max(1, Number(options.maxFiles))
      : DEFAULT_LIMITS.maxFiles,
    maxMembersPerFile: Number.isFinite(Number(options.maxMembersPerFile))
      ? Math.max(1, Number(options.maxMembersPerFile))
      : DEFAULT_LIMITS.maxMembersPerFile,
    maxEdges: Number.isFinite(Number(options.maxEdges))
      ? Math.max(1, Number(options.maxEdges))
      : DEFAULT_LIMITS.maxEdges
  };

  const repoMap = readJsonOptional(path.join(indexDir, 'repo_map.json'), warnings) || [];
  const fileRelations = readJsonOptional(path.join(indexDir, 'file_relations.json'), warnings) || [];
  const graphRelations = readJsonOptional(path.join(indexDir, 'graph_relations.json'), warnings) || null;
  const fileMeta = readJsonOptional(path.join(indexDir, 'file_meta.json'), warnings) || null;

  let chunkMeta = [];
  try {
    chunkMeta = loadChunkMeta(indexDir);
  } catch (err) {
    warnings.push(`chunk_meta missing: ${err?.message || err}`);
  }
  chunkMeta = hydrateChunkMeta(chunkMeta, fileMeta);

  const membersByFile = new Map();
  const memberById = new Map();
  let hasDataflow = false;
  let hasControlFlow = false;

  for (const entry of repoMap) {
    if (!entry?.file || !entry?.name) continue;
    const file = normalizePath(entry.file);
    const symbolId = buildSymbolId({
      file,
      name: entry.name,
      kind: entry.kind,
      startLine: entry.startLine,
      chunkId: null
    });
    upsertMember(membersByFile, memberById, file, symbolId, {
      name: entry.name,
      kind: entry.kind,
      signature: entry.signature || null,
      exported: entry.exported === true,
      range: {
        startLine: Number.isFinite(entry.startLine) ? entry.startLine : null,
        endLine: Number.isFinite(entry.endLine) ? entry.endLine : null
      }
    });
  }

  for (const chunk of chunkMeta) {
    const meta = chunk?.metaV2 || null;
    const file = normalizePath(meta?.file || chunk?.file || '');
    const name = meta?.name || chunk?.name || null;
    if (!file || !name) continue;
    const symbolId = buildSymbolId({
      file,
      name,
      kind: meta?.kind || chunk?.kind || null,
      startLine: meta?.range?.startLine || chunk?.startLine,
      chunkId: meta?.chunkId || null
    });
    const dataflow = normalizeDataflow(meta?.dataflow || chunk?.docmeta?.dataflow);
    const controlFlow = normalizeControlFlow(meta?.controlFlow || chunk?.docmeta?.controlFlow);
    if (dataflow) hasDataflow = true;
    if (controlFlow) hasControlFlow = true;
    upsertMember(membersByFile, memberById, file, symbolId, {
      name,
      kind: meta?.kind || chunk?.kind || null,
      signature: meta?.signature || chunk?.docmeta?.signature || null,
      params: normalizeArray(meta?.params || chunk?.docmeta?.params),
      returns: meta?.returns || chunk?.docmeta?.returns || null,
      modifiers: normalizeModifiers(meta?.modifiers || chunk?.docmeta?.modifiers),
      dataflow,
      controlFlow,
      range: {
        startLine: Number.isFinite(meta?.range?.startLine)
          ? meta.range.startLine
          : (Number.isFinite(chunk?.startLine) ? chunk.startLine : null),
        endLine: Number.isFinite(meta?.range?.endLine)
          ? meta.range.endLine
          : (Number.isFinite(chunk?.endLine) ? chunk.endLine : null)
      }
    });
  }

  if (!hasDataflow) warnings.push('dataflow metadata missing; map is limited');
  if (!hasControlFlow) warnings.push('controlFlow metadata missing; map is limited');

  const includeExportedOnly = options.onlyExported === true;
  if (includeExportedOnly) {
    for (const [file, members] of membersByFile.entries()) {
      membersByFile.set(
        file,
        (members || []).filter((member) => member.exported === true)
      );
    }
  }

  let nodes = buildFileNodes(membersByFile);
  let edges = [];

  const memberIndex = buildMemberIndex(memberById);

  if (includes.includes('imports')) {
    edges.push(...buildImportEdges({ fileRelations }));
  }
  if (includes.includes('exports')) {
    edges.push(...buildExportEdges({ membersByFile }));
  }

  const callEdges = graphRelations?.callGraph
    ? buildEdgesFromGraph({ graph: graphRelations.callGraph, type: 'call', memberById })
    : [];
  if (includes.includes('calls')) {
    edges.push(...callEdges);
    if (!callEdges.length) {
      edges.push(...buildEdgesFromCalls({ chunkMeta, memberIndex, memberById }));
    }
  }

  const usageEdges = graphRelations?.usageGraph
    ? buildEdgesFromGraph({ graph: graphRelations.usageGraph, type: 'usage', memberById })
    : [];
  if (includes.includes('usages')) {
    edges.push(...usageEdges);
    if (!usageEdges.length) {
      edges.push(...buildEdgesFromUsage({ chunkMeta, memberIndex, memberById }));
    }
  }

  if (includes.includes('dataflow')) {
    edges.push(...buildEdgesFromCallSummaries({ chunkMeta, memberById }));
  }

  if (includes.includes('aliases')) {
    edges.push(...buildAliasEdges({ membersByFile }));
  }

  const { scope, focus } = resolveFocus(options);
  ({ nodes, edges } = applyScopeFilter({ nodes, edges, scope, focus }));
  ({ nodes, edges } = applyCollapse({ nodes, edges, collapse: options.collapse }));

  const { nodes: limitedNodes, edges: limitedEdges, dropped } = applyLimits({
    nodes,
    edges,
    limits,
    topKByDegree: options.topKByDegree === true
  });

  const summary = {
    counts: {
      files: limitedNodes.length,
      members: limitedNodes.reduce((acc, node) => acc + (node.members?.length || 0), 0),
      edges: limitedEdges.length
    },
    dropped,
    truncated: dropped.files > 0 || dropped.members > 0 || dropped.edges > 0,
    limits,
    include: includes,
    scope,
    focus: focus || null,
    collapse: options.collapse || 'none',
    topKByDegree: options.topKByDegree === true
  };

  const viewer = {
    ...VIEWER_DEFAULTS,
    ...options.viewer,
    controls: {
      ...VIEWER_DEFAULTS.controls,
      ...(options.viewer?.controls || {}),
      wasd: {
        ...VIEWER_DEFAULTS.controls.wasd,
        ...(options.viewer?.controls?.wasd || {})
      }
    }
  };

  return {
    version: MAP_MODEL_VERSION,
    generatedAt: new Date().toISOString(),
    root: { path: repoRoot, id: null },
    mode: options.mode || null,
    options: {
      scope,
      focus: focus || null,
      include: includes,
      onlyExported: includeExportedOnly,
      collapse: options.collapse || 'none',
      limits,
      topKByDegree: options.topKByDegree === true
    },
    legend: DEFAULT_LEGEND,
    nodes: sortBy(limitedNodes, (node) => node.path),
    edges: sortBy(limitedEdges, (edge) => {
      const from = edge.from?.member || edge.from?.file || '';
      const to = edge.to?.member || edge.to?.file || '';
      return `${edge.type}:${from}->${to}:${edge.label || ''}`;
    }),
    viewer,
    summary,
    warnings: sortBy(unique(warnings), (entry) => entry)
  };
}

export function buildNodeList(mapModel) {
  const nodes = [];
  for (const file of mapModel.nodes || []) {
    nodes.push({
      id: file.path,
      label: `file: ${file.path}`,
      file: file.path,
      kind: 'file',
      startLine: 1,
      endLine: null
    });
    for (const member of file.members || []) {
      const line = member.range?.startLine || null;
      nodes.push({
        id: member.id,
        label: `${member.name} (${file.path}:${line || 1})`,
        file: file.path,
        kind: member.kind || member.type || 'symbol',
        startLine: line,
        endLine: member.range?.endLine || null
      });
    }
  }
  const sorted = sortBy(nodes, (entry) => entry.label);
  return {
    generatedAt: mapModel.generatedAt,
    root: mapModel.root?.path || null,
    nodes: sorted
  };
}

export function buildMapCacheKey({ buildId, options }) {
  const payload = { buildId: buildId || null, options: options || null };
  return sha1(stableStringify(payload));
}
