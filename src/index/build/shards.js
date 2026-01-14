import path from 'node:path';
import { fileExt, toPosix } from '../../shared/files.js';
import { sha1 } from '../../shared/hash.js';
import { resolveSpecialCodeExt } from '../constants.js';
import { getLanguageForFile } from '../language-registry.js';
import { estimateFileCost } from './perf-profile.js';
import greedyNumberPartitioning from 'greedy-number-partitioning';

const resolveExt = (absPath) => {
  const baseName = path.basename(absPath);
  const specialExt = resolveSpecialCodeExt(baseName);
  if (specialExt) return specialExt;
  return fileExt(absPath);
};

const resolveDirKey = (rel, depth) => {
  const relPosix = toPosix(rel || '');
  const parts = relPosix.split('/').filter(Boolean);
  if (parts.length <= 1) return '.';
  const dirParts = parts.slice(0, -1);
  if (!Number.isFinite(depth)) {
    return dirParts.join('/');
  }
  if (depth <= 0) {
    return '.';
  }
  if (depth >= dirParts.length) {
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

const getEntryByteCount = (entry) => {
  const candidate = entry?.bytes ?? entry?.size ?? entry?.stat?.size ?? 0;
  return Number.isFinite(candidate) ? candidate : 0;
};

const computeShardLineTotal = (shard, lineCounts) => {
  let total = 0;
  for (const entry of shard.entries) {
    total += getEntryLineCount(entry, lineCounts);
  }
  return total;
};

const computeShardByteTotal = (shard) => {
  let total = 0;
  for (const entry of shard.entries) {
    total += getEntryByteCount(entry);
  }
  return total;
};

const computeShardCostTotal = (shard) => {
  let total = 0;
  for (const entry of shard.entries) {
    const cost = Number.isFinite(entry?.costMs) ? entry.costMs : 0;
    total += cost;
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
  const entries = [...shard.entries].sort((a, b) => ((a.rel || '') < (b.rel || '') ? -1 : (a.rel || '') > (b.rel || '') ? 1 : 0));
  if (entries.length <= 1) return [shard];
  const parts = [];
  let current = [];
  let currentLines = 0;
  let currentBytes = 0;
  let currentCost = 0;
  for (const entry of entries) {
    const lines = getEntryLineCount(entry, lineCounts);
    const bytes = getEntryByteCount(entry);
    const cost = Number.isFinite(entry?.costMs) ? entry.costMs : lines;
    if (current.length && currentLines + lines > targetLines) {
      parts.push({
        entries: current,
        lines: currentLines,
        bytes: currentBytes,
        cost: currentCost
      });
      current = [];
      currentLines = 0;
      currentBytes = 0;
      currentCost = 0;
    }
    current.push(entry);
    currentLines += lines;
    currentBytes += bytes;
    currentCost += cost;
  }
  if (current.length) {
    parts.push({
      entries: current,
      lines: currentLines,
      bytes: currentBytes,
      cost: currentCost
    });
  }
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
      byteCount: part.bytes,
      costMs: part.cost,
      splitFrom: shard.label,
      splitIndex: index + 1,
      splitTotal: parts.length
    };
  });
};

const splitShardByCapacity = (shard, lineCounts, options = {}) => {
  const targetCost = Number.isFinite(options.targetCost) ? options.targetCost : null;
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : null;
  const maxLines = Number.isFinite(options.maxLines) ? options.maxLines : null;
  if (!targetCost && !maxBytes && !maxLines) return [shard];
  const entries = [...shard.entries].sort((a, b) => ((a.rel || '') < (b.rel || '') ? -1 : (a.rel || '') > (b.rel || '') ? 1 : 0));
  if (entries.length <= 1) return [shard];
  const parts = [];
  let current = [];
  let currentLines = 0;
  let currentBytes = 0;
  let currentCost = 0;
  for (const entry of entries) {
    const lines = getEntryLineCount(entry, lineCounts);
    const bytes = getEntryByteCount(entry);
    const cost = Number.isFinite(entry?.costMs) ? entry.costMs : lines;
    const exceedsCost = targetCost && (currentCost + cost) > targetCost;
    const exceedsBytes = maxBytes && (currentBytes + bytes) > maxBytes;
    const exceedsLines = maxLines && (currentLines + lines) > maxLines;
    if (current.length && (exceedsCost || exceedsBytes || exceedsLines)) {
      parts.push({
        entries: current,
        lines: currentLines,
        bytes: currentBytes,
        cost: currentCost
      });
      current = [];
      currentLines = 0;
      currentBytes = 0;
      currentCost = 0;
    }
    current.push(entry);
    currentLines += lines;
    currentBytes += bytes;
    currentCost += cost;
  }
  if (current.length) {
    parts.push({
      entries: current,
      lines: currentLines,
      bytes: currentBytes,
      cost: currentCost
    });
  }
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
      byteCount: part.bytes,
      costMs: part.cost,
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

export function planShardBatches(items, batchCount, { resolveWeight } = {}) {
  const list = Array.isArray(items) ? items : [];
  const count = Number.isFinite(batchCount) ? Math.max(1, Math.floor(batchCount)) : 1;
  if (!list.length) return [];
  if (count <= 1) return [list.slice()];
  const weights = list.map((item, index) => {
    const value = resolveWeight ? resolveWeight(item, index) : 0;
    return Number.isFinite(value) && value > 0 ? value : 0;
  });
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  if (!totalWeight) {
    const buckets = Array.from({ length: count }, () => []);
    list.forEach((item, index) => {
      buckets[index % count].push(item);
    });
    return buckets.filter((bucket) => bucket.length);
  }
  const partitions = greedyNumberPartitioning(weights.slice(), count);
  const weightQueues = new Map();
  list.forEach((item, index) => {
    const weight = weights[index];
    const entry = weightQueues.get(weight) || { items: [], offset: 0 };
    entry.items.push(item);
    weightQueues.set(weight, entry);
  });
  const takeNext = (weight) => {
    const entry = weightQueues.get(weight);
    if (!entry || entry.offset >= entry.items.length) return null;
    const item = entry.items[entry.offset];
    entry.offset += 1;
    return item;
  };
  const batches = partitions.map((partition) => {
    const batch = [];
    for (const weight of partition) {
      const item = takeNext(weight);
      if (item) batch.push(item);
    }
    return batch;
  });
  const assignedCount = batches.reduce((sum, batch) => sum + batch.length, 0);
  if (assignedCount < list.length) {
    const remainder = [];
    for (const entry of weightQueues.values()) {
      for (let i = entry.offset; i < entry.items.length; i += 1) {
        remainder.push(entry.items[i]);
      }
    }
    if (remainder.length) {
      const target = batches.reduce((best, batch) => (batch.length < best.length ? batch : best), batches[0]);
      target.push(...remainder);
    }
  }
  return batches.filter((batch) => batch.length);
}

const balanceShardsGreedy = (shards, targetCount, mode) => {
  if (!Number.isFinite(targetCount) || targetCount <= 0) return shards;
  if (shards.length <= targetCount) return shards;
  const batches = planShardBatches(shards, Math.floor(targetCount), {
    resolveWeight: (shard) => shard.costMs || shard.lineCount || shard.entries.length || 0
  });
  return batches
    .filter((batch) => batch.length)
    .map((batch, index) => {
      const entries = [];
      let lineCount = 0;
      let byteCount = 0;
      let costMs = 0;
      const mergedFrom = [];
      for (const shard of batch) {
        entries.push(...shard.entries);
        lineCount += shard.lineCount || 0;
        byteCount += shard.byteCount || 0;
        costMs += shard.costMs || 0;
        mergedFrom.push(shard.label || shard.id);
      }
      const label = `balanced/${index + 1}`;
      return {
        id: buildShardId(mode, label),
        label,
        dir: 'balanced',
        lang: 'mixed',
        mode,
        entries: entries.sort((a, b) => ((a.rel || '') < (b.rel || '') ? -1 : (a.rel || '') > (b.rel || '') ? 1 : 0)),
        lineCount,
        byteCount,
        costMs,
        mergedFrom
      };
    });
};

export function planShards(
  entries,
  {
    mode,
    maxShards = null,
    minFiles = null,
    dirDepth = 1,
    lineCounts = null,
    perfProfile = null,
    featureWeights = null,
    maxShardBytes = null,
    maxShardLines = null
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
    const entryLines = getEntryLineCount(entry, lineCountMap);
    const entryBytes = getEntryByteCount(entry);
    if (Number.isFinite(entryLines)) entry.lines = entryLines;
    if (Number.isFinite(entryBytes)) entry.bytes = entryBytes;
    const entryCost = perfProfile
      ? estimateFileCost({
        perfProfile,
        languageId: lang?.id || langKey,
        bytes: entryBytes,
        lines: entryLines,
        featureWeights
      })
      : entryLines;
    entry.costMs = Number.isFinite(entryCost) ? entryCost : entryLines;
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
    shard.entries.sort((a, b) => ((a.rel || '') < (b.rel || '') ? -1 : (a.rel || '') > (b.rel || '') ? 1 : 0));
    shard.lineCount = computeShardLineTotal(shard, lineCountMap);
    shard.byteCount = computeShardByteTotal(shard);
    shard.costMs = computeShardCostTotal(shard);
  }
  const mergedLineTotals = shards.map((shard) => shard.lineCount || 0);
  const mergedCostTotals = shards.map((shard) => shard.costMs || 0);
  const splitLineTarget = computeTenthLargest(mergedLineTotals);
  const splitCostTarget = perfProfile ? computeTenthLargest(mergedCostTotals) : 0;
  const splitThreshold = splitLineTarget > 0 ? splitLineTarget : 0;
  const capBytes = Number.isFinite(maxShardBytes) ? maxShardBytes : null;
  const capLines = Number.isFinite(maxShardLines) ? maxShardLines : null;
  const targetCost = splitCostTarget > 0 ? splitCostTarget : null;
  const splitShards = [];
  for (const shard of shards) {
    const needsCapacitySplit = shard.entries.length > 1
      && ((targetCost && shard.costMs > targetCost)
        || (capBytes && shard.byteCount > capBytes)
        || (capLines && shard.lineCount > capLines));
    if (needsCapacitySplit) {
      splitShards.push(...splitShardByCapacity(shard, lineCountMap, {
        targetCost,
        maxBytes: capBytes,
        maxLines: capLines
      }));
      continue;
    }
    if (!targetCost && !capBytes && !capLines
      && splitThreshold > 0
      && shard.lineCount > splitThreshold
      && shard.entries.length > 1) {
      splitShards.push(...splitShardByLines(shard, lineCountMap, splitThreshold));
      continue;
    }
    splitShards.push(shard);
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
      const scratch = { entries: remainder };
      keep.push({
        id: buildShardId(mode, label),
        label,
        dir: 'misc',
        lang: 'other',
        entries: remainder,
        lineCount: computeShardLineTotal(scratch, lineCountMap),
        byteCount: computeShardByteTotal(scratch),
        costMs: computeShardCostTotal(scratch)
      });
    }
    shards = keep;
  }

  if (Number.isFinite(maxShards) && maxShards > 0) {
    shards = balanceShardsGreedy(shards, Math.floor(maxShards), mode);
  }

  return shards.sort((a, b) => {
  const labelA = a.label || a.id;
  const labelB = b.label || b.id;
  return labelA < labelB ? -1 : labelA > labelB ? 1 : 0;
});
}
