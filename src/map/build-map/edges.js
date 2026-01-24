import { normalizePath } from '../utils.js';
import { buildSymbolId, resolveMemberByName } from './symbols.js';

export const buildEdgesFromGraph = ({ graph, type, memberById }) => {
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

export const buildEdgesFromCalls = ({ chunkMeta, memberIndex, memberById }) => {
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

export const buildEdgesFromUsage = ({ chunkMeta, memberIndex, memberById }) => {
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

export const buildEdgesFromCallSummaries = ({ chunkMeta, memberById }) => {
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

export const buildImportEdges = ({ fileRelations, fileSet }) => {
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

export const buildExportEdges = ({ membersByFile }) => {
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

export const buildAliasEdges = ({ membersByFile }) => {
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
