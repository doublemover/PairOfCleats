export const normalizeCallText = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
};

export const truncateCallText = (value, maxLen) => {
  const normalized = normalizeCallText(value);
  if (!normalized) return '';
  if (!Number.isFinite(Number(maxLen)) || maxLen <= 0 || normalized.length <= maxLen) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, Number(maxLen) - 3))}...`;
};

export const resolveCalleeParts = (calleeName) => {
  if (!calleeName) return { calleeRaw: null, calleeNormalized: null, receiver: null };
  const raw = String(calleeName);
  const parts = raw.split('.').filter(Boolean);
  if (!parts.length) return { calleeRaw: raw, calleeNormalized: raw, receiver: null };
  if (parts.length === 1) {
    return { calleeRaw: raw, calleeNormalized: parts[0], receiver: null };
  }
  return {
    calleeRaw: raw,
    calleeNormalized: parts[parts.length - 1],
    receiver: parts.slice(0, -1).join('.')
  };
};

export const resolveCallLocation = (node) => {
  if (!node || typeof node !== 'object') return null;
  const start = Number.isFinite(node.start)
    ? node.start
    : (Array.isArray(node.range) ? node.range[0] : null);
  const end = Number.isFinite(node.end)
    ? node.end
    : (Array.isArray(node.range) ? node.range[1] : null);
  const loc = node.loc || null;
  const startLine = Number.isFinite(loc?.start?.line) ? loc.start.line : null;
  const startCol = Number.isFinite(loc?.start?.column) ? loc.start.column + 1 : null;
  const endLine = Number.isFinite(loc?.end?.line) ? loc.end.line : null;
  const endCol = Number.isFinite(loc?.end?.column) ? loc.end.column + 1 : null;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return {
    start,
    end,
    startLine,
    startCol,
    endLine,
    endCol
  };
};
