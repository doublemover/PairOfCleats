import path from 'node:path';
import { fileExt, toPosix } from '../../shared/files.js';
import { sha1 } from '../../shared/hash.js';
import { isSpecialCodeFile } from '../constants.js';
import { getLanguageForFile } from '../language-registry.js';

const resolveExt = (absPath) => {
  const baseName = path.basename(absPath);
  const rawExt = fileExt(absPath);
  if (rawExt) return rawExt;
  if (!isSpecialCodeFile(baseName)) return rawExt;
  return baseName.toLowerCase() === 'dockerfile' ? '.dockerfile' : '.makefile';
};

const resolveDirKey = (rel, depth) => {
  const relPosix = toPosix(rel || '');
  const parts = relPosix.split('/').filter(Boolean);
  if (parts.length <= 1) return '.';
  const dirParts = parts.slice(0, -1);
  if (!Number.isFinite(depth) || depth <= 0 || depth >= dirParts.length) {
    return dirParts.join('/');
  }
  return dirParts.slice(0, depth).join('/');
};

const buildShardLabel = (dirKey, langKey) => `${dirKey}/${langKey}`;

const buildShardId = (mode, label) => {
  const key = `${mode || 'unknown'}:${label}`;
  return `s-${sha1(key).slice(0, 12)}`;
};

export function planShards(
  entries,
  {
    mode,
    maxShards = null,
    minFiles = null,
    dirDepth = 1
  } = {}
) {
  const groups = new Map();
  for (const entry of entries) {
    const rel = entry.rel || '';
    const dirKey = resolveDirKey(rel, dirDepth);
    const ext = resolveExt(entry.abs || rel);
    const lang = mode === 'code' ? getLanguageForFile(ext, rel) : null;
    const langKey = mode === 'code'
      ? (lang?.id || ext || 'unknown')
      : (ext || 'prose');
    const label = buildShardLabel(dirKey, langKey);
    const shardId = buildShardId(mode, label);
    const shard = groups.get(label)
      || { id: shardId, label, dir: dirKey, lang: langKey, entries: [] };
    shard.entries.push(entry);
    groups.set(label, shard);
  }

  let shards = Array.from(groups.values());
  if (Number.isFinite(minFiles) && minFiles > 1) {
    const keep = [];
    const remainder = [];
    for (const shard of shards) {
      if (shard.entries.length >= minFiles) {
        keep.push(shard);
      } else {
        remainder.push(...shard.entries);
      }
    }
    if (remainder.length) {
      const label = 'misc/other';
      keep.push({
        id: buildShardId(mode, label),
        label,
        dir: 'misc',
        lang: 'other',
        entries: remainder
      });
    }
    shards = keep;
  }

  if (Number.isFinite(maxShards) && maxShards > 0 && shards.length > maxShards) {
    shards.sort((a, b) => b.entries.length - a.entries.length);
    const keep = shards.slice(0, Math.max(1, maxShards - 1));
    const remainder = shards.slice(keep.length).flatMap((shard) => shard.entries);
    const label = 'misc/overflow';
    keep.push({
      id: buildShardId(mode, label),
      label,
      dir: 'misc',
      lang: 'overflow',
      entries: remainder
    });
    shards = keep;
  }

  return shards.sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id));
}
