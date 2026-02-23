import { MODE_SHORT_LABEL, THROUGHPUT_TOTAL_LABEL_WIDTH } from './aggregate.js';

export const formatNumber = (value, digits = 1) => (
  Number.isFinite(value) ? value.toFixed(digits) : 'n/a'
);

export const formatCount = (value) => (
  Number.isFinite(value) ? value.toLocaleString() : 'n/a'
);

export const formatMs = (value) => {
  if (!Number.isFinite(value)) return 'n/a';
  if (value < 1000) return `${Math.round(value)}ms`;
  const seconds = value / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = (seconds % 60).toFixed(0);
  return `${minutes}m ${rem}s`;
};

export const formatBytes = (value) => {
  if (!Number.isFinite(value)) return 'n/a';
  const abs = Math.abs(value);
  if (abs < 1024) return `${Math.round(value)} B`;
  const kb = value / 1024;
  if (Math.abs(kb) < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (Math.abs(mb) < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
};

export const formatBytesPerSec = (value) => {
  if (!Number.isFinite(value)) return 'n/a';
  const mb = value / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB/s`;
  return `${(mb / 1024).toFixed(2)} GB/s`;
};

const formatFixed = (value, { digits = 1, width = 5 } = {}) => (
  Number.isFinite(value) ? value.toFixed(digits).padStart(width) : 'n/a'.padStart(width)
);

export const formatModeThroughputLine = ({ label, entry }) => {
  const chunks = formatFixed(entry?.chunksPerSec, { digits: 1, width: 5 });
  const tokens = formatFixed(entry?.tokensPerSec, { digits: 1, width: 7 });
  const mb = Number.isFinite(entry?.bytesPerSec) ? (entry.bytesPerSec / (1024 * 1024)) : null;
  const bytes = formatFixed(mb, { digits: 1, width: 4 });
  const files = formatFixed(entry?.filesPerSec, { digits: 1, width: 5 });
  return (
    `${label.padStart(8)}: ${chunks} chunks/s  | ` +
    `${tokens} tokens/s  | ${bytes} MB/s | ${files} files/s`
  );
};

export const formatModeChunkRate = (label, entry) => `${label} ${formatNumber(entry?.chunksPerSec)}`;
const SECTION_META_LEFT_WIDTH = `${formatFixed(0, { digits: 1, width: 5 })} chunks/s  `.length;
export const formatSectionMetaLine = ({ label, left, right }) => (
  `  ${label.padStart(8)}: ${String(left || '').padEnd(SECTION_META_LEFT_WIDTH)}| ${String(right || '')}`
);

export const buildIndexedTotalsRows = (modeTotalsMap) => {
  const ordered = ['code', 'prose', 'extracted-prose', 'records'];
  return ordered.map((modeKey) => {
    const totals = modeTotalsMap.get(modeKey);
    if (!Number.isFinite(totals?.lines) || totals.lines <= 0) return null;
    const linesPerSec = (Number.isFinite(totals.durationMs) && totals.durationMs > 0)
      ? (totals.lines / (totals.durationMs / 1000))
      : null;
    const msPerLine = (Number.isFinite(totals.durationMs) && totals.durationMs > 0 && totals.lines > 0)
      ? (totals.durationMs / totals.lines)
      : null;
    return {
      modeKey,
      label: MODE_SHORT_LABEL[modeKey] || modeKey,
      linesText: `${formatCount(totals.lines)} lines`,
      filesText: `${formatCount(totals.files)} files`,
      bytesText: formatBytes(totals.bytes),
      linesPerSecText: `${formatNumber(linesPerSec)} lines/s`,
      msPerLineText: `${formatNumber(msPerLine, 3)} ms/line`
    };
  }).filter(Boolean);
};

export const formatThroughputTotalsCell = (value, unit, width) => (
  `${formatFixed(value, { digits: 1, width })} ${unit}`
);

export const printAlignedTotalLine = (label, value) => {
  console.error(`  ${label.padStart(THROUGHPUT_TOTAL_LABEL_WIDTH)}: ${value}`);
};

export const formatPct = (value) => (
  Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'n/a'
);

export const formatAstField = ({ totals, observed }, key) => (
  (Number(observed?.[key]) || 0) > 0 ? formatCount(totals?.[key]) : 'n/a'
);
