export function formatShardFileProgress(entry, options = {}) {
  const shardByLabel = options.shardByLabel instanceof Map ? options.shardByLabel : new Map();
  const lineTotal = options.lineTotal;
  const count = Number.isFinite(entry.fileIndex) ? entry.fileIndex : entry.count;
  const total = Number.isFinite(entry.fileTotal) ? entry.fileTotal : entry.total;
  const pct = Number.isFinite(entry.pct)
    ? entry.pct
    : (Number.isFinite(count) && Number.isFinite(total) && total > 0)
      ? (count / total) * 100
      : null;
  const pctText = Number.isFinite(pct) ? `${pct.toFixed(1)}%` : null;
  const shardLabel = entry.shardLabel;
  const shardInfo = shardLabel ? shardByLabel.get(shardLabel) : null;
  const shardText = shardInfo
    ? `${shardInfo.index}/${shardInfo.total}`
    : (shardLabel || null);
  const shardPrefix = shardText ? `[shard ${shardText}]` : '[shard]';
  const countText = Number.isFinite(count) && Number.isFinite(total)
    ? `${count}/${total}`
    : null;
  const lineText = Number.isFinite(lineTotal) && lineTotal > 0
    ? `lines ${lineTotal.toLocaleString()}`
    : null;
  const head = [shardPrefix, countText, pctText ? `(${pctText})` : null]
    .filter(Boolean)
    .join(' ');
  const tail = [lineText, entry.file].filter(Boolean);
  return tail.length ? `${head} | ${tail.join(' | ')}` : head;
}
