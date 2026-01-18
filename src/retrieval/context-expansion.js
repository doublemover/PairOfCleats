const pushIds = (acc, ids, reason) => {
  for (const id of ids) {
    if (id == null) continue;
    acc.push({ id, reason });
  }
};

export function buildContextIndex({ chunkMeta, repoMap }) {
  const byName = new Map();
  const byFile = new Map();
  if (Array.isArray(chunkMeta)) {
    for (const chunk of chunkMeta) {
      if (!chunk) continue;
      if (chunk.name) {
        const list = byName.get(chunk.name) || [];
        list.push(chunk.id);
        byName.set(chunk.name, list);
      }
      if (chunk.file) {
        const list = byFile.get(chunk.file) || [];
        list.push(chunk.id);
        byFile.set(chunk.file, list);
      }
    }
  }

  const repoMapByName = new Map();
  if (Array.isArray(repoMap)) {
    for (const entry of repoMap) {
      if (!entry?.name || !entry?.file) continue;
      const list = repoMapByName.get(entry.name) || [];
      list.push(entry.file);
      repoMapByName.set(entry.name, list);
    }
  }

  return { byName, byFile, repoMapByName, chunkMeta, repoMap };
}

const serializeMap = (map) => {
  if (!map || typeof map.entries !== 'function') return {};
  const out = {};
  for (const [key, value] of map.entries()) {
    out[key] = Array.isArray(value) ? value : Array.from(value || []);
  }
  return out;
};

const hydrateMap = (raw) => {
  const map = new Map();
  if (!raw || typeof raw !== 'object') return map;
  for (const [key, value] of Object.entries(raw)) {
    map.set(key, Array.isArray(value) ? value : []);
  }
  return map;
};

export function serializeContextIndex(contextIndex) {
  if (!contextIndex) return null;
  return {
    version: 1,
    byName: serializeMap(contextIndex.byName),
    byFile: serializeMap(contextIndex.byFile),
    repoMapByName: serializeMap(contextIndex.repoMapByName)
  };
}

export function hydrateContextIndex(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    byName: hydrateMap(raw.byName),
    byFile: hydrateMap(raw.byFile),
    repoMapByName: hydrateMap(raw.repoMapByName)
  };
}

export function expandContext({
  hits,
  chunkMeta,
  fileRelations,
  repoMap,
  options = {},
  allowedIds = null,
  contextIndex = null
}) {
  if (!Array.isArray(hits) || !hits.length || !Array.isArray(chunkMeta)) {
    return [];
  }
  const maxPerHit = Number.isFinite(Number(options.maxPerHit)) ? Math.max(0, Number(options.maxPerHit)) : 4;
  const maxTotal = Number.isFinite(Number(options.maxTotal)) ? Math.max(0, Number(options.maxTotal)) : 40;
  const includeCalls = options.includeCalls !== false;
  const includeImports = options.includeImports !== false;
  const includeExports = options.includeExports === true;
  const includeUsages = options.includeUsages === true;

  const resolvedIndex = contextIndex || buildContextIndex({ chunkMeta, repoMap });
  const { byName, byFile, repoMapByName } = resolvedIndex;

  const primaryIds = new Set(hits.map((hit) => hit?.id).filter((id) => id != null));
  const addedIds = new Set();
  const contextHits = [];

  for (const hit of hits) {
    if (contextHits.length >= maxTotal) break;
    const sourceId = hit?.id;
    const sourceChunk = sourceId != null ? chunkMeta[sourceId] : null;
    if (!sourceChunk) continue;
    const candidates = [];
    if (includeCalls) {
      const calls = sourceChunk.codeRelations?.calls || [];
      for (const entry of calls) {
        const callee = Array.isArray(entry) ? entry[1] : null;
        if (!callee) continue;
        const ids = byName.get(callee) || [];
        if (ids.length) {
          pushIds(candidates, ids, `call:${callee}`);
        } else {
          const files = repoMapByName.get(callee) || [];
          for (const file of files) {
            pushIds(candidates, byFile.get(file) || [], `call:${callee}`);
          }
        }
      }
    }
    if (fileRelations && sourceChunk.file) {
      const relations = typeof fileRelations.get === 'function'
        ? fileRelations.get(sourceChunk.file)
        : fileRelations[sourceChunk.file];
      if (relations) {
        if (includeImports && Array.isArray(relations.importLinks)) {
          for (const file of relations.importLinks) {
            pushIds(candidates, byFile.get(file) || [], `import:${file}`);
          }
        }
        if (includeUsages && Array.isArray(relations.usages)) {
          for (const usage of relations.usages) {
            pushIds(candidates, byName.get(usage) || [], `usage:${usage}`);
          }
        }
        if (includeExports && Array.isArray(relations.exports)) {
          for (const exp of relations.exports) {
            pushIds(candidates, byName.get(exp) || [], `export:${exp}`);
          }
        }
      }
    }

    let addedForHit = 0;
    for (const candidate of candidates) {
      if (contextHits.length >= maxTotal || addedForHit >= maxPerHit) break;
      const id = candidate.id;
      if (primaryIds.has(id) || addedIds.has(id)) continue;
      if (allowedIds && !allowedIds.has(id)) continue;
      const chunk = chunkMeta[id];
      if (!chunk) continue;
      addedIds.add(id);
      addedForHit += 1;
      contextHits.push({
        ...chunk,
        score: 0,
        scoreType: 'context',
        context: {
          sourceId,
          reason: candidate.reason
        }
      });
    }
  }

  return contextHits;
}
