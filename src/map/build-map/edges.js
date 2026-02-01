import { normalizePath } from '../utils.js';
import { resolveMemberByName } from './symbols.js';

export const buildEdgesFromGraph = ({
  graph,
  type,
  memberById,
  memberByChunkUid,
  aliasById = null
}) => {
  if (!graph || !Array.isArray(graph.nodes)) return [];
  const edges = [];
  const resolveId = (id) => {
    if (!id) return null;
    if (memberById.has(id)) return id;
    const fromChunk = memberByChunkUid?.get(id);
    if (fromChunk) return fromChunk;
    return aliasById?.get(id) || null;
  };
  for (const node of graph.nodes) {
    if (!node?.id || !Array.isArray(node.out)) continue;
    const sourceId = resolveId(node.id);
    if (!sourceId) continue;
    const sourceMember = memberById.get(sourceId) || null;
    const sourceFile = sourceMember?.file || null;
    for (const target of node.out) {
      if (!target) continue;
      const targetId = resolveId(target);
      if (!targetId) continue;
      const targetMember = memberById.get(targetId) || null;
      const targetFile = targetMember?.file || null;
      edges.push({
        type,
        from: { member: sourceId, file: sourceFile },
        to: { member: targetId, file: targetFile },
        label: null
      });
    }
  }
  return edges;
};

export const buildEdgesFromCalls = ({
  chunkMeta,
  memberIndex,
  memberById,
  memberByChunkUid,
  aliasById = null
}) => {
  const edges = [];
  for (const chunk of chunkMeta || []) {
    if (!chunk?.file || !chunk?.name) continue;
    const sourceChunkUid = chunk.metaV2?.chunkUid || chunk.chunkUid || null;
    const sourceId = sourceChunkUid ? memberByChunkUid?.get(sourceChunkUid) : null;
    if (!sourceId) continue;
    const sourceMember = memberById.get(sourceId) || null;
    if (!memberById.has(sourceId)) continue;
    const relations = chunk.codeRelations || {};
    const links = Array.isArray(relations.callLinks) ? relations.callLinks : null;
    if (links) {
      for (const link of links) {
        const ref = link?.to || link?.ref || null;
        const resolvedUid = ref?.status === 'resolved' ? ref?.resolved?.chunkUid : null;
        let targetId = resolvedUid ? memberByChunkUid?.get(resolvedUid) : null;
        if (!targetId && resolvedUid) targetId = aliasById?.get(resolvedUid) || null;
        if (!targetId && link?.legacy?.target && link?.legacy?.file) {
          targetId = resolveMemberByName(memberIndex, link.legacy.target, normalizePath(link.legacy.file))?.id || null;
        }
        if (!targetId) continue;
        const targetMember = memberById.get(targetId) || null;
        edges.push({
          type: 'call',
          from: { member: sourceId, file: sourceMember?.file || null },
          to: { member: targetId, file: targetMember?.file || null },
          label: null
        });
      }
      continue;
    }
    if (Array.isArray(relations.calls)) {
      for (const entry of relations.calls) {
        const targetName = Array.isArray(entry) ? entry[1] : null;
        if (!targetName) continue;
        const targetMember = resolveMemberByName(memberIndex, targetName, normalizePath(chunk.file));
        if (!targetMember) continue;
        edges.push({
          type: 'call',
          from: { member: sourceId, file: sourceMember?.file || null },
          to: { member: targetMember.id, file: targetMember?.file || null },
          label: null
        });
      }
    }
  }
  return edges;
};

export const buildEdgesFromUsage = ({
  chunkMeta,
  memberIndex,
  memberById,
  memberByChunkUid,
  aliasById = null
}) => {
  const edges = [];
  for (const chunk of chunkMeta || []) {
    if (!chunk?.file || !chunk?.name) continue;
    const sourceChunkUid = chunk.metaV2?.chunkUid || chunk.chunkUid || null;
    const sourceId = sourceChunkUid ? memberByChunkUid?.get(sourceChunkUid) : null;
    if (!sourceId) continue;
    const sourceMember = memberById.get(sourceId) || null;
    if (!memberById.has(sourceId)) continue;
    const relations = chunk.codeRelations || {};
    const links = Array.isArray(relations.usageLinks) ? relations.usageLinks : null;
    if (links) {
      for (const link of links) {
        const ref = link?.to || link?.ref || null;
        const resolvedUid = ref?.status === 'resolved' ? ref?.resolved?.chunkUid : null;
        let targetId = resolvedUid ? memberByChunkUid?.get(resolvedUid) : null;
        if (!targetId && resolvedUid) targetId = aliasById?.get(resolvedUid) || null;
        if (!targetId && link?.legacy?.target && link?.legacy?.file) {
          targetId = resolveMemberByName(memberIndex, link.legacy.target, normalizePath(link.legacy.file))?.id || null;
        }
        if (!targetId) continue;
        const targetMember = memberById.get(targetId) || null;
        edges.push({
          type: 'usage',
          from: { member: sourceId, file: sourceMember?.file || null },
          to: { member: targetId, file: targetMember?.file || null },
          label: null
        });
      }
      continue;
    }
    if (Array.isArray(relations.usages)) {
      for (const usage of relations.usages) {
        const targetMember = resolveMemberByName(memberIndex, usage, normalizePath(chunk.file));
        if (!targetMember) continue;
        edges.push({
          type: 'usage',
          from: { member: sourceId, file: sourceMember?.file || null },
          to: { member: targetMember.id, file: targetMember?.file || null },
          label: null
        });
      }
    }
  }
  return edges;
};

export const buildEdgesFromCallSummaries = ({ chunkMeta, memberById, memberByChunkUid }) => {
  const edges = [];
  for (const chunk of chunkMeta || []) {
    const meta = chunk?.metaV2;
    if (!chunk?.file || !chunk?.name || !meta?.relations?.callSummaries) continue;
    const sourceChunkUid = meta.chunkUid || chunk.chunkUid || null;
    const sourceId = sourceChunkUid ? memberByChunkUid?.get(sourceChunkUid) : null;
    if (!memberById.has(sourceId)) continue;
    const sourceMember = memberById.get(sourceId) || null;
    for (const summary of meta.relations.callSummaries) {
      const resolvedUid = summary?.resolvedCalleeChunkUid || summary?.targetChunkUid || null;
      let targetId = resolvedUid ? memberByChunkUid?.get(resolvedUid) : null;
      if (!targetId && summary?.file && summary?.target) {
        const legacyTarget = `${normalizePath(summary.file)}::${summary.target}`;
        if (memberById.has(legacyTarget)) targetId = legacyTarget;
      }
      if (!targetId || !memberById.has(targetId)) continue;
      const targetMember = memberById.get(targetId) || null;
      const args = summary.argMap ? Object.keys(summary.argMap) : [];
      const argLabel = args.length ? `args:${args.slice(0, 3).join(',')}` : null;
      edges.push({
        type: 'dataflow',
        from: { member: sourceId, file: sourceMember?.file || null },
        to: { member: targetId, file: targetMember?.file || null },
        label: argLabel
      });
      if (Array.isArray(summary.returnTypes) && summary.returnTypes.length) {
        edges.push({
          type: 'dataflow',
          from: { member: targetId, file: targetMember?.file || null },
          to: { member: sourceId, file: sourceMember?.file || null },
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
        to: { member: member.id, file: member.file || file },
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
          from: { member: member.id, file },
          to: { member: member.id, file },
          label: `alias:${alias}`,
          meta: { file }
        });
      }
    }
  }
  return edges;
};
