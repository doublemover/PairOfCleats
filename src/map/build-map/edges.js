import { normalizePath } from '../utils.js';
import { resolveMemberByName } from './symbols.js';

const internValue = (intern, value) => (intern ? intern(value) : value);

const resolveRelationSource = ({ chunk, memberById, memberByChunkUid, intern }) => {
  if (!chunk?.file || !chunk?.name) return null;
  const sourceChunkUid = chunk.metaV2?.chunkUid || chunk.chunkUid || null;
  const sourceId = sourceChunkUid ? memberByChunkUid?.get(sourceChunkUid) : null;
  if (!sourceId || !memberById.has(sourceId)) return null;
  const sourceMember = memberById.get(sourceId) || null;
  return {
    sourceId,
    sourceFile: internValue(intern, sourceMember?.file || null)
  };
};

const resolveRelationLinkTargetId = ({
  link,
  memberIndex,
  memberByChunkUid,
  aliasById,
  fallbackFile = null
}) => {
  const ref = link?.to || link?.ref || null;
  const resolvedUid = ref?.status === 'resolved' ? ref?.resolved?.chunkUid : null;
  let targetId = resolvedUid ? memberByChunkUid?.get(resolvedUid) : null;
  if (!targetId && resolvedUid) targetId = aliasById?.get(resolvedUid) || null;
  if (!targetId && link?.legacy?.target) {
    const legacyFile = link?.legacy?.file || fallbackFile;
    if (legacyFile) {
      targetId = resolveMemberByName(memberIndex, link.legacy.target, normalizePath(legacyFile))?.id || null;
    }
  }
  return targetId;
};

const buildMemberEdge = ({
  type,
  sourceId,
  sourceFile,
  targetId,
  targetMember = null,
  memberById,
  intern
}) => {
  const resolvedTargetMember = targetMember || memberById.get(targetId) || null;
  const targetFile = internValue(intern, resolvedTargetMember?.file || null);
  return {
    type,
    from: { member: sourceId, file: sourceFile },
    to: { member: targetId, file: targetFile },
    label: null
  };
};

function* buildEdgesFromCodeRelations({
  chunkMeta,
  memberIndex,
  memberById,
  memberByChunkUid,
  aliasById = null,
  intern = null,
  type,
  linksKey,
  legacyKey,
  resolveLegacyTargetName
}) {
  const resolvedType = internValue(intern, type);
  for (const chunk of chunkMeta || []) {
    const source = resolveRelationSource({ chunk, memberById, memberByChunkUid, intern });
    if (!source) continue;
    const relations = chunk.codeRelations || {};
    const links = Array.isArray(relations[linksKey]) ? relations[linksKey] : null;
    if (links) {
      for (const link of links) {
        const targetId = resolveRelationLinkTargetId({
          link,
          memberIndex,
          memberByChunkUid,
          aliasById
        });
        if (!targetId) continue;
        yield buildMemberEdge({
          type: resolvedType,
          sourceId: source.sourceId,
          sourceFile: source.sourceFile,
          targetId,
          memberById,
          intern
        });
      }
      continue;
    }
    if (!Array.isArray(relations[legacyKey])) continue;
    for (const entry of relations[legacyKey]) {
      const targetName = resolveLegacyTargetName(entry);
      if (!targetName) continue;
      const targetMember = resolveMemberByName(memberIndex, targetName, normalizePath(chunk.file));
      if (!targetMember) continue;
      yield buildMemberEdge({
        type: resolvedType,
        sourceId: source.sourceId,
        sourceFile: source.sourceFile,
        targetId: targetMember.id,
        targetMember,
        memberById,
        intern
      });
    }
  }
}

export function* buildEdgesFromGraph({
  graph,
  type,
  memberById,
  memberByChunkUid,
  aliasById = null,
  intern = null
}) {
  if (!graph || !Array.isArray(graph.nodes)) return;
  const resolveId = (id) => {
    if (!id) return null;
    if (memberById.has(id)) return id;
    const fromChunk = memberByChunkUid?.get(id);
    if (fromChunk) return fromChunk;
    return aliasById?.get(id) || null;
  };
  const resolvedType = intern ? intern(type) : type;
  for (const node of graph.nodes) {
    if (!node?.id || !Array.isArray(node.out)) continue;
    const sourceId = resolveId(node.id);
    if (!sourceId) continue;
    const sourceMember = memberById.get(sourceId) || null;
    const sourceFile = sourceMember?.file || null;
    const internedSourceFile = intern ? intern(sourceFile) : sourceFile;
    for (const target of node.out) {
      if (!target) continue;
      const targetId = resolveId(target);
      if (!targetId) continue;
      const targetMember = memberById.get(targetId) || null;
      const targetFile = targetMember?.file || null;
      const internedTargetFile = intern ? intern(targetFile) : targetFile;
      yield {
        type: resolvedType,
        from: { member: sourceId, file: internedSourceFile },
        to: { member: targetId, file: internedTargetFile },
        label: null
      };
    }
  }
}

export function* buildEdgesFromCalls({
  chunkMeta,
  memberIndex,
  memberById,
  memberByChunkUid,
  aliasById = null,
  intern = null
}) {
  yield* buildEdgesFromCodeRelations({
    chunkMeta,
    memberIndex,
    memberById,
    memberByChunkUid,
    aliasById,
    intern,
    type: 'call',
    linksKey: 'callLinks',
    legacyKey: 'calls',
    resolveLegacyTargetName: (entry) => (Array.isArray(entry) ? entry[1] : null)
  });
}

export function* buildEdgesFromUsage({
  chunkMeta,
  memberIndex,
  memberById,
  memberByChunkUid,
  aliasById = null,
  intern = null
}) {
  yield* buildEdgesFromCodeRelations({
    chunkMeta,
    memberIndex,
    memberById,
    memberByChunkUid,
    aliasById,
    intern,
    type: 'usage',
    linksKey: 'usageLinks',
    legacyKey: 'usages',
    resolveLegacyTargetName: (usage) => usage
  });
}

export function* buildEdgesFromCallSummaries({ chunkMeta, memberById, memberByChunkUid, intern = null }) {
  const resolvedType = intern ? intern('dataflow') : 'dataflow';
  const returnLabel = intern ? intern('return') : 'return';
  for (const chunk of chunkMeta || []) {
    const meta = chunk?.metaV2;
    if (!chunk?.file || !chunk?.name || !meta?.relations?.callSummaries) continue;
    const sourceChunkUid = meta.chunkUid || chunk.chunkUid || null;
    const sourceId = sourceChunkUid ? memberByChunkUid?.get(sourceChunkUid) : null;
    if (!memberById.has(sourceId)) continue;
    const sourceMember = memberById.get(sourceId) || null;
    const sourceFile = intern ? intern(sourceMember?.file || null) : sourceMember?.file || null;
    for (const summary of meta.relations.callSummaries) {
      const resolvedUid = summary?.resolvedCalleeChunkUid || summary?.targetChunkUid || null;
      let targetId = resolvedUid ? memberByChunkUid?.get(resolvedUid) : null;
      if (!targetId && summary?.file && summary?.target) {
        const legacyTarget = `${normalizePath(summary.file)}::${summary.target}`;
        if (memberById.has(legacyTarget)) targetId = legacyTarget;
      }
      if (!targetId || !memberById.has(targetId)) continue;
      const targetMember = memberById.get(targetId) || null;
      const targetFile = intern ? intern(targetMember?.file || null) : targetMember?.file || null;
      const args = summary.argMap ? Object.keys(summary.argMap) : [];
      const argLabelRaw = args.length ? `args:${args.slice(0, 3).join(',')}` : null;
      const argLabel = intern ? intern(argLabelRaw) : argLabelRaw;
      yield {
        type: resolvedType,
        from: { member: sourceId, file: sourceFile },
        to: { member: targetId, file: targetFile },
        label: argLabel
      };
      if (Array.isArray(summary.returnTypes) && summary.returnTypes.length) {
        yield {
          type: resolvedType,
          from: { member: targetId, file: targetFile },
          to: { member: sourceId, file: sourceFile },
          label: returnLabel
        };
      }
    }
  }
}

export function* buildImportEdges({ fileRelations, fileSet, intern = null }) {
  if (!Array.isArray(fileRelations)) return;
  const resolvedType = intern ? intern('import') : 'import';
  for (const entry of fileRelations) {
    if (!entry?.file) continue;
    const fromRaw = normalizePath(entry.file);
    const from = intern ? intern(fromRaw) : fromRaw;
    if (fileSet && !fileSet.has(from)) continue;
    const imports = Array.isArray(entry.relations?.importLinks)
      ? entry.relations.importLinks
      : [];
    for (const target of imports) {
      if (!target) continue;
      const toRaw = normalizePath(target);
      const to = intern ? intern(toRaw) : toRaw;
      if (fileSet && !fileSet.has(to)) continue;
      yield {
        type: resolvedType,
        from: { file: from },
        to: { file: to },
        label: null
      };
    }
  }
}

export function* buildExportEdges({ membersByFile, intern = null }) {
  const resolvedType = intern ? intern('export') : 'export';
  for (const [file, members] of membersByFile.entries()) {
    const fromFile = intern ? intern(file) : file;
    for (const member of members || []) {
      if (member.exported !== true) continue;
      const targetFile = intern ? intern(member.file || file) : member.file || file;
      const label = intern ? intern(member.name || null) : member.name || null;
      yield {
        type: resolvedType,
        from: { file: fromFile },
        to: { member: member.id, file: targetFile },
        label
      };
    }
  }
}

export function* buildAliasEdges({ membersByFile, intern = null }) {
  const resolvedType = intern ? intern('alias') : 'alias';
  for (const [file, members] of membersByFile.entries()) {
    const resolvedFile = intern ? intern(file) : file;
    for (const member of members || []) {
      const aliases = member.dataflow?.aliases || null;
      if (!Array.isArray(aliases) || !aliases.length) continue;
      for (const alias of aliases.slice(0, 3)) {
        if (!alias) continue;
        const labelRaw = `alias:${alias}`;
        const label = intern ? intern(labelRaw) : labelRaw;
        yield {
          type: resolvedType,
          from: { member: member.id, file: resolvedFile },
          to: { member: member.id, file: resolvedFile },
          label,
          meta: { file: resolvedFile }
        };
      }
    }
  }
}
