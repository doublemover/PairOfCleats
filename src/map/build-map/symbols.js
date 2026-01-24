import { sha1 } from '../../shared/hash.js';
import { normalizePath, sortBy } from '../utils.js';

const ANON_NAMES = new Set(['(anonymous)', '<anonymous>', 'anonymous']);

export const buildSymbolId = ({ file, name, kind, startLine, chunkId }) => {
  const safeFile = normalizePath(file || '');
  const safeName = String(name || '').trim();
  const lowered = safeName.toLowerCase();
  if (safeName && !ANON_NAMES.has(lowered)) return `${safeFile}::${safeName}`;
  if (chunkId) return `${safeFile}::${chunkId}`;
  const suffix = Number.isFinite(startLine) ? startLine : 0;
  const kindTag = kind ? String(kind) : 'symbol';
  return `${safeFile}::${kindTag}:${suffix}`;
};

export const buildPortId = (symbolId) => `p_${sha1(symbolId).slice(0, 12)}`;

const memberTypeFromKind = (kind) => {
  const value = typeof kind === 'string' ? kind.toLowerCase() : '';
  if (value.includes('class') || value.includes('interface') || value.includes('struct')) return 'class';
  if (value.includes('function') || value.includes('method') || value.includes('ctor')) return 'function';
  return 'symbol';
};

export const upsertMember = (membersByFile, memberById, file, id, base) => {
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

export const buildMemberIndex = (memberById) => {
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

export const resolveMemberByName = (memberIndex, name, fileHint) => {
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
