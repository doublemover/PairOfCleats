export const resolveSeedNodeRef = (seed) => {
  if (!seed || typeof seed !== 'object') return null;
  if (seed.type && typeof seed.type === 'string') return seed;
  const status = seed.status;
  if (status && seed.resolved && typeof seed.resolved === 'object') {
    const resolved = seed.resolved;
    if (resolved.chunkUid) return { type: 'chunk', chunkUid: resolved.chunkUid };
    if (resolved.symbolId) return { type: 'symbol', symbolId: resolved.symbolId };
    if (resolved.path) return { type: 'file', path: resolved.path };
  }
  const candidates = Array.isArray(seed.candidates) ? seed.candidates : [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    if (candidate.chunkUid) return { type: 'chunk', chunkUid: candidate.chunkUid };
    if (candidate.symbolId) return { type: 'symbol', symbolId: candidate.symbolId };
    if (candidate.path) return { type: 'file', path: candidate.path };
  }
  return null;
};

export const resolveNodeMeta = (ref, chunkInfo, importGraphIndex, normalizeImport) => {
  if (!ref || typeof ref !== 'object') return {};
  if (ref.type === 'chunk') {
    const meta = chunkInfo.get(ref.chunkUid);
    return meta ? {
      file: meta.file ?? null,
      kind: meta.kind ?? null,
      name: meta.name ?? null,
      signature: meta.signature ?? null
    } : {};
  }
  if (ref.type === 'file') {
    const normalizedPath = normalizeImport(ref.path);
    const meta = normalizedPath ? importGraphIndex.get(normalizedPath) : null;
    const file = normalizeImport(meta?.file || ref.path) || ref.path;
    return { file };
  }
  if (ref.type === 'symbol') {
    return {
      name: ref.symbolId
    };
  }
  return {};
};

export const formatEvidence = (edgeType, fromRef, toRef, callSiteIndex) => {
  if (edgeType !== 'call') return null;
  if (!fromRef || !toRef) return null;
  if (fromRef.type !== 'chunk' || toRef.type !== 'chunk') return null;
  const key = `${fromRef.chunkUid}|${toRef.chunkUid}`;
  const list = callSiteIndex.get(key);
  if (!list || !list.length) return null;
  const ids = list.slice(0, 25);
  return { callSiteIds: ids };
};
