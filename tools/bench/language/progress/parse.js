const buildProgressRegex = /^\s*(Files|Imports)\s+(\d+)\/(\d+)\s+\((\d+(?:\.\d+)?)%\)/i;
const buildCombinedFileRegex = /^\s*Files\s+(\d+)\/(\d+)\s+\((\d+(?:\.\d+)?)%\)\s+(?:\[(.+?)\]\s+)?(?:File\s+)?(\d+)\/(\d+)(?:\s+lines\s+[0-9,\.]+)?\s+(.+)$/i;
const buildFileOnlyRegex = /^\s*(?:\[(.+?)\]\s+)?(?:File\s+)?(\d+)\/(\d+)(?:\s+lines\s+[0-9,\.]+)?\s+(.+)$/i;
const buildShardRegex = /^\s*(?:\u2192|->)\s+Shard\s+(\d+)\/(\d+):\s+([^\r\n\[]+?)(?:\s+\[[^\]]+\])?\s+\((\d+)\s+files\)/i;
const buildImportStatsRegex = /^\s*\u2192\s*Imports:\s+modules=(\d+),\s*edges=(\d+),\s*files=(\d+)/i;
const buildScanRegex = /Scanning\s+(code|prose)/i;
const buildLineRegex = /^\s*Line\s+(\d+)\s*\/\s*(\d+)/i;

export const normalizeShardLabel = (raw) => {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed || /^shard$/i.test(trimmed)) return '';
  return trimmed.replace(/^shard\s+/i, '').trim();
};

export const parseShardLine = (line) => {
  const match = buildShardRegex.exec(line);
  if (!match) return null;
  return {
    index: Number.parseInt(match[1], 10),
    total: Number.parseInt(match[2], 10),
    shardLabel: match[3] ? match[3].trim() : '',
    fileCount: Number.parseInt(match[4], 10)
  };
};

export const parseImportStatsLine = (line) => {
  const match = buildImportStatsRegex.exec(line);
  if (!match) return null;
  return {
    modules: Number.parseInt(match[1], 10),
    edges: Number.parseInt(match[2], 10),
    files: Number.parseInt(match[3], 10)
  };
};

export const parseFileProgressLine = (line) => {
  const combined = buildCombinedFileRegex.exec(line);
  if (combined) {
    return {
      count: Number.parseInt(combined[1], 10),
      total: Number.parseInt(combined[2], 10),
      pct: Number.parseFloat(combined[3]),
      shardLabel: normalizeShardLabel(combined[4]),
      fileIndex: Number.parseInt(combined[5], 10),
      fileTotal: Number.parseInt(combined[6], 10),
      file: combined[7] ? combined[7].trim() : ''
    };
  }
  const solo = buildFileOnlyRegex.exec(line);
  if (!solo) return null;
  return {
    count: null,
    total: null,
    pct: null,
    shardLabel: normalizeShardLabel(solo[1]),
    fileIndex: Number.parseInt(solo[2], 10),
    fileTotal: Number.parseInt(solo[3], 10),
    file: solo[4] ? solo[4].trim() : ''
  };
};

export const parseProgressLine = (line) => {
  const match = buildProgressRegex.exec(line);
  if (!match) return null;
  return {
    step: match[1],
    count: Number.parseInt(match[2], 10),
    total: Number.parseInt(match[3], 10),
    pct: Number.parseFloat(match[4])
  };
};

export const parseLineProgress = (line) => {
  const match = buildLineRegex.exec(line);
  if (!match) return null;
  return {
    current: Number.parseInt(match[1], 10),
    total: Number.parseInt(match[2], 10)
  };
};

export const parseScanMode = (line) => {
  const match = buildScanRegex.exec(line);
  if (!match) return null;
  return match[1].toLowerCase();
};
