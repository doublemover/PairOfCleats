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

const resolveParentDirKey = (dirKey) => {
  if (!dirKey || dirKey === '.') return '.';
  const parts = dirKey.split('/').filter(Boolean);
  if (parts.length <= 1) return '.';
  return parts.slice(0, -1).join('/');
};

const getEntryLineCount = (entry, lineCounts) => {
  const rel = entry?.rel || '';
  const fromMap = lineCounts ? lineCounts.get(toPosix(rel)) : null;
  const candidate = fromMap ?? entry?.lines ?? entry?.lineCount ?? entry?.stat?.lines;
  return Number.isFinite(candidate) ? candidate : 0;
};

const computeShardLineTotal = (shard, lineCounts) => {
  let total = 0;
  for (const entry of shard.entries) {
    total += getEntryLineCount(entry, lineCounts);
  }
  return total;
};

const computeTenthLargest = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => b - a);
  const index = Math.min(9, sorted.length - 1);
  return sorted[index] || 0;
};

const hasHugeFile = (shard, lineCounts, threshold) => {
  if (!threshold || threshold <= 0) return false;
  for (const entry of shard.entries) {
    if (getEntryLineCount(entry, lineCounts) >= threshold) return true;
  }
  return false;
};

const splitShardByLines = (shard, lineCounts, targetLines) => {
  if (!targetLines || targetLines <= 0) return [shard];
  const entries = [...shard.entries].sort((a, b) => (a.rel || '').localeCompare(b.rel || ''));
  if (entries.length <= 1) return [shard];
  const parts = [];
  let current = [];
  let currentLines = 0;
  for (const entry of entries) {
    const lines = getEntryLineCount(entry, lineCounts);
    if (current.length && currentLines + lines > targetLines) {
      parts.push({ entries: current, lines: currentLines });
      current = [];
      currentLines = 0;
    }
    current.push(entry);
    currentLines += lines;
  }
  if (current.length) parts.push({ entries: current, lines: currentLines });
  if (parts.length <= 1) return [shard];
  return parts.map((part, index) => {
    const label = `${shard.label}#${index + 1}of${parts.length}`;
    return {
      id: buildShardId(shard.mode, label),
      label,
      dir: shard.dir,
      lang: shard.lang,
      mode: shard.mode,
      entries: part.entries,
      lineCount: part.lines,
      splitFrom: shard.label,
      splitIndex: index + 1,
      splitTotal: parts.length
    };
  });
};

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
    dirDepth = 1,
    lineCounts = null
  } = {}
) {
  const lineCountMap = lineCounts instanceof Map ? lineCounts : null;
  if (lineCountMap) {
    for (const entry of entries) {
      const lines = lineCountMap.get(toPosix(entry.rel || ''));
      if (Number.isFinite(lines)) entry.lines = lines;
    }
  }
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
      || { id: shardId, label, dir: dirKey, lang: langKey, mode, entries: [] };
    shard.entries.push(entry);
    groups.set(label, shard);
  }

  let shards = Array.from(groups.values());
  const lineTotals = shards.map((shard) => computeShardLineTotal(shard, lineCountMap));
  const tenthLargest = computeTenthLargest(lineTotals);
  const hugeThreshold = tenthLargest > 0 ? Math.floor(tenthLargest * 0.5) : 0;
  const minFilesLimit = Number.isFinite(minFiles) && minFiles > 0 ? Math.floor(minFiles) : 3;
  const minFilesForSubdir = Math.max(3, minFilesLimit);
  if (Number.isFinite(dirDepth) && dirDepth > 0 && shards.length) {
    const merged = new Map();
    for (const shard of shards) {
      const isSubdir = shard.dir && shard.dir !== '.';
      const allowSmall = !isSubdir
        || shard.entries.length >= minFilesForSubdir
        || hasHugeFile(shard, lineCountMap, hugeThreshold);
      if (allowSmall) {
        const existing = merged.get(shard.label);
        if (existing && existing !== shard) {
          existing.entries.push(...shard.entries);
        } else {
          merged.set(shard.label, shard);
        }
        continue;
      }
      const parentDir = resolveParentDirKey(shard.dir);
      const parentLabel = buildShardLabel(parentDir, shard.lang);
      const parentId = buildShardId(mode, parentLabel);
      const target = merged.get(parentLabel)
        || { id: parentId, label: parentLabel, dir: parentDir, lang: shard.lang, mode, entries: [] };
      target.entries.push(...shard.entries);
      merged.set(parentLabel, target);
    }
    shards = Array.from(merged.values());
  }

  for (const shard of shards) {
    shard.entries.sort((a, b) => (a.rel || '').localeCompare(b.rel || ''));
    shard.lineCount = computeShardLineTotal(shard, lineCountMap);
  }
  const mergedLineTotals = shards.map((shard) => shard.lineCount || 0);
  const splitTarget = computeTenthLargest(mergedLineTotals);
  const splitThreshold = splitTarget > 0 ? splitTarget : 0;
  const splitShards = [];
  for (const shard of shards) {
    if (splitThreshold > 0 && shard.lineCount > splitThreshold && shard.entries.length > 1) {
      splitShards.push(...splitShardByLines(shard, lineCountMap, splitThreshold));
    } else {
      splitShards.push(shard);
    }
  }
  shards = splitShards;
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
        entries: remainder,
        lineCount: computeShardLineTotal({ entries: remainder }, lineCountMap)
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
      entries: remainder,
      lineCount: computeShardLineTotal({ entries: remainder }, lineCountMap)
    });
    shards = keep;
  }

  return shards.sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id));
}
