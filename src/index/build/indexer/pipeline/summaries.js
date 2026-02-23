export const countFieldEntries = (fieldMaps) => {
  if (!fieldMaps || typeof fieldMaps !== 'object') return 0;
  let total = 0;
  for (const entry of Object.values(fieldMaps)) {
    if (entry && typeof entry.size === 'number') total += entry.size;
  }
  return total;
};

export const countFieldArrayEntries = (fieldArrays) => {
  if (!fieldArrays || typeof fieldArrays !== 'object') return 0;
  let total = 0;
  for (const entry of Object.values(fieldArrays)) {
    if (Array.isArray(entry)) total += entry.length;
  }
  return total;
};

export const summarizeGraphRelations = (graphRelations) => {
  if (!graphRelations || typeof graphRelations !== 'object') return null;
  const summarize = (graph) => ({
    nodes: Number.isFinite(graph?.nodeCount) ? graph.nodeCount : 0,
    edges: Number.isFinite(graph?.edgeCount) ? graph.edgeCount : 0
  });
  return {
    callGraph: summarize(graphRelations.callGraph),
    usageGraph: summarize(graphRelations.usageGraph),
    importGraph: summarize(graphRelations.importGraph)
  };
};

export const summarizeDocumentExtractionForMode = (state) => {
  const fileInfoByPath = state?.fileInfoByPath;
  if (!(fileInfoByPath && typeof fileInfoByPath.entries === 'function')) return null;
  const files = [];
  const extractorMap = new Map();
  const totals = {
    files: 0,
    pages: 0,
    paragraphs: 0,
    units: 0
  };
  for (const [file, info] of fileInfoByPath.entries()) {
    const extraction = info?.extraction;
    if (!extraction || extraction.status !== 'ok') continue;
    const extractorName = extraction?.extractor?.name || null;
    const extractorVersion = extraction?.extractor?.version || null;
    const extractorTarget = extraction?.extractor?.target || null;
    const extractorKey = `${extractorName || 'unknown'}|${extractorVersion || 'unknown'}|${extractorTarget || ''}`;
    if (!extractorMap.has(extractorKey)) {
      extractorMap.set(extractorKey, {
        name: extractorName,
        version: extractorVersion,
        target: extractorTarget
      });
    }
    const unitCounts = {
      pages: Number(extraction?.counts?.pages) || 0,
      paragraphs: Number(extraction?.counts?.paragraphs) || 0,
      totalUnits: Number(extraction?.counts?.totalUnits) || 0
    };
    totals.files += 1;
    totals.pages += unitCounts.pages;
    totals.paragraphs += unitCounts.paragraphs;
    totals.units += unitCounts.totalUnits;
    files.push({
      file,
      sourceType: extraction.sourceType || null,
      extractor: {
        name: extractorName,
        version: extractorVersion,
        target: extractorTarget
      },
      sourceBytesHash: extraction.sourceBytesHash || null,
      sourceBytesHashAlgo: extraction.sourceBytesHashAlgo || 'sha256',
      unitCounts,
      normalizationPolicy: extraction.normalizationPolicy || null
    });
  }
  files.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  if (!files.length) return null;
  const extractors = Array.from(extractorMap.values()).sort((a, b) => {
    const left = `${a.name || ''}|${a.version || ''}|${a.target || ''}`;
    const right = `${b.name || ''}|${b.version || ''}|${b.target || ''}`;
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });
  return {
    schemaVersion: 1,
    files,
    extractors,
    totals
  };
};

export const summarizePostingsQueue = (stats) => {
  if (!stats || typeof stats !== 'object') return null;
  return {
    limits: stats.limits || null,
    highWater: stats.highWater || null,
    backpressure: stats.backpressure || null,
    oversize: stats.oversize || null,
    memory: stats.memory || null
  };
};
