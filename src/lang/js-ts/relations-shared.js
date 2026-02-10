export const normalizeCallText = (value) => {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (!/\s/.test(trimmed)) return trimmed;
  return trimmed.replace(/\s+/g, ' ');
};

export const truncateCallText = (value, maxLen) => {
  const normalized = normalizeCallText(value);
  if (!normalized) return '';
  const resolvedMax = Number(maxLen);
  if (!Number.isFinite(resolvedMax) || resolvedMax <= 0 || normalized.length <= resolvedMax) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, resolvedMax - 3))}...`;
};

export const resolveCalleeParts = (calleeName) => {
  if (!calleeName) return { calleeRaw: null, calleeNormalized: null, receiver: null };
  const raw = String(calleeName);
  const lastDot = raw.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === raw.length - 1) {
    return { calleeRaw: raw, calleeNormalized: raw, receiver: null };
  }
  const calleeNormalized = raw.slice(lastDot + 1);
  const receiver = raw.slice(0, lastDot);
  return {
    calleeRaw: raw,
    calleeNormalized,
    receiver
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
