import { resolveChunkId } from '../../index/chunk-id.js';
import { normalizePath } from '../utils.js';
import { buildSymbolId, upsertMember } from './symbols.js';
import { normalizeArray, normalizeControlFlow, normalizeDataflow, normalizeModifiers } from './normalize.js';

// Only indexed, repository-relative paths establish file authority. Import
// targets alone must not invent files outside the selected generation.
export const mapFilePath = (value) => {
  if (typeof value !== 'string' || !value || value.includes('\0')) return null;
  const file = normalizePath(value);
  if (file.startsWith('/') || /^[A-Za-z]:/.test(file)
    || file.split('/').some(part => part === '..' || part === '.')) return null;
  return file;
};

const identityText = value => value === 0 || value ? String(value) : null;
const originOf = entry => entry?.virtualPath || entry?.segment?.virtualPath || null;
const compatible = (member, entry) => (
  (!Number.isFinite(entry.startLine) || member.range.startLine === entry.startLine)
  && (!Number.isFinite(entry.endLine) || member.range.endLine === entry.endLine)
  && (!entry.kind || !member.kind || member.kind === entry.kind)
  && (!entry.signature || !member.signature || member.signature === entry.signature)
  && (!originOf(entry) || member.virtualPath === originOf(entry))
);

export const buildMapMembers = ({ repoMap, chunkMeta, fileMeta, fileRelations, intern, strict, warnings }) => {
  const membersByFile = new Map(), memberById = new Map(), aliasById = new Map();
  const memberByChunkUid = new Map(), byLocation = new Map();
  let hasDataflow = false, hasControlFlow = false, ambiguous = 0, unresolved = 0;
  const admitFile = value => {
    const file = mapFilePath(value);
    if (file && !membersByFile.has(file)) membersByFile.set(intern(file), []);
    return file && intern(file);
  };
  for (const row of fileMeta || []) admitFile(row?.file);
  for (const row of fileRelations || []) admitFile(row?.file);
  const addAlias = (map, alias, id) => {
    const key = identityText(alias);
    if (key == null || key === id) return;
    // Null is an ambiguity tombstone, including for legacy file/name aliases.
    if (map.has(key) && map.get(key) !== id) map.set(key, null);
    else if (!map.has(key)) map.set(key, id);
  };
  const locationKey = (file, name) => JSON.stringify([file, name]);
  for (const chunk of chunkMeta) {
    const meta = chunk?.metaV2 || {};
    const file = admitFile(meta.file || chunk?.file);
    const name = intern(meta.name || chunk?.name || null);
    if (!file || !name) continue;
    const chunkUid = identityText(meta.chunkUid || chunk.chunkUid);
    if (!chunkUid) {
      const message = `chunkUid missing for ${file}::${name}`;
      if (strict) throw new Error(message);
      warnings.push(message);
      continue;
    }
    const kind = intern(meta.kind || chunk.kind || null);
    const id = identityText(buildSymbolId({ symbolId: meta.symbol?.symbolId, chunkUid }));
    const virtualPath = originOf(meta) || originOf(chunk);
    const prior = memberById.get(id);
    if (prior && (prior.file !== file || prior.virtualPath !== virtualPath || prior.name !== name)) {
      throw new Error(`Conflicting canonical map member identity: ${id}`);
    }
    const dataflow = normalizeDataflow(meta.dataflow || chunk.docmeta?.dataflow, intern);
    const controlFlow = normalizeControlFlow(meta.controlFlow || chunk.docmeta?.controlFlow);
    hasDataflow ||= Boolean(dataflow);
    hasControlFlow ||= Boolean(controlFlow);
    const member = upsertMember(membersByFile, memberById, file, id, {
      name, kind, signature: intern(meta.signature || chunk.docmeta?.signature || null),
      params: normalizeArray(meta.params || chunk.docmeta?.params, intern),
      returns: meta.returns || chunk.docmeta?.returns || null,
      modifiers: normalizeModifiers(meta.modifiers || chunk.docmeta?.modifiers),
      dataflow, controlFlow, sourceRank: 2,
      range: {
        startLine: Number.isFinite(meta.range?.startLine) ? meta.range.startLine : (chunk.startLine ?? null),
        endLine: Number.isFinite(meta.range?.endLine) ? meta.range.endLine : (chunk.endLine ?? null)
      }
    });
    member.virtualPath = virtualPath;
    // A symbol may own several physical chunks. Preserve every durable alias.
    if (memberByChunkUid.has(chunkUid) && memberByChunkUid.get(chunkUid) !== id) {
      throw new Error(`Conflicting canonical map chunk identity: ${chunkUid}`);
    }
    memberByChunkUid.set(chunkUid, id);
    addAlias(aliasById, chunkUid, id);
    addAlias(aliasById, resolveChunkId(chunk), id);
    addAlias(aliasById, `${file}::${name}`, id);
    const key = locationKey(file, name);
    if (!byLocation.has(key)) byLocation.set(key, new Set());
    byLocation.get(key).add(id);
  }

  for (const entry of repoMap) {
    const file = admitFile(entry?.file);
    const name = intern(entry?.name || null);
    if (!file || !name) continue;
    const uid = identityText(entry.chunkUid), symbolId = identityText(entry.symbolId);
    const uidId = uid && memberByChunkUid.get(uid);
    const symbolMember = symbolId && memberById.get(symbolId);
    if (uidId && symbolMember && uidId !== symbolMember.id) {
      throw new Error(`Conflicting repo_map member identity: ${file}::${name}`);
    }
    let member = memberById.get(uidId) || symbolMember || null;
    // Durable identity proves the join even when a producer's display signature
    // or physical chunk range differs from the canonical symbol metadata.
    if (member && (member.file !== file || member.name !== name
      || (originOf(entry) && member.virtualPath && member.virtualPath !== originOf(entry)))) {
      throw new Error(`repo_map identity disagrees with chunk_meta: ${file}::${name}`);
    }
    if (!member && (uid || symbolId)) {
      unresolved += 1;
      warnings.push(`repo_map durable identity unavailable in selected generation: ${file}::${name}`);
      continue;
    }
    // Durable joins are already authoritative. Building and scanning their
    // same-name legacy bucket adds quadratic work for generated overloads and
    // cannot change the selected member or its conflict checks above.
    if (!member) {
      const candidates = [...(byLocation.get(locationKey(file, name)) || [])]
        .map(id => memberById.get(id)).filter(candidate => compatible(candidate, entry));
      if (candidates.length === 1) member = candidates[0];
      if (candidates.length > 1) {
        ambiguous += 1;
        warnings.push(`Ambiguous legacy repo_map member: ${file}::${name}`);
        continue;
      }
    }
    const id = member?.id || buildSymbolId({ file, name, kind: entry.kind, startLine: entry.startLine });
    if (!member && memberById.has(id) && !compatible(memberById.get(id), entry)) {
      ambiguous += 1;
      warnings.push(`Conflicting legacy repo_map member: ${file}::${name}`);
      continue;
    }
    upsertMember(membersByFile, memberById, file, id, {
      name, kind: intern(entry.kind || null), signature: intern(entry.signature || null),
      exported: typeof entry.exported === 'boolean' ? entry.exported : null,
      range: { startLine: entry.startLine ?? null, endLine: entry.endLine ?? null }, sourceRank: 1
    });
    addAlias(aliasById, buildSymbolId({ file, name, startLine: entry.startLine }), id);
  }
  return { membersByFile, memberById, aliasById, memberByChunkUid, hasDataflow, hasControlFlow,
    identitySummary: { ambiguous, unresolved, complete: ambiguous === 0 && unresolved === 0 } };
};
