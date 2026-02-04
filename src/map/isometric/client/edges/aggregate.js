export const createFlowSegmentAggregator = ({ quantizeStep, normalizeMemberId, fileByMember }) => {
  const flowSegmentsByType = new Map();

  const addEndpoint = (entry, endpoint) => {
    if (!endpoint) return;
    const memberKey = normalizeMemberId(endpoint.member);
    if (memberKey) {
      entry.endpoints.add(`member:${memberKey}`);
      const memberFile = fileByMember.get(memberKey) || fileByMember.get(endpoint.member);
      if (memberFile) entry.endpoints.add(`file:${memberFile}`);
    }
    if (endpoint.file) {
      entry.endpoints.add(`file:${endpoint.file}`);
    }
  };

  const quantizeValue = (value) => {
    if (quantizeStep <= 0.001) return Number(value.toFixed(3));
    return Number((Math.round(value / quantizeStep) * quantizeStep).toFixed(3));
  };

  const addFlowSegment = (type, x1, y1, z1, x2, y2, z2, weight, color, dir, edge) => {
    if (Math.abs(x1 - x2) < 0.0001 && Math.abs(y1 - y2) < 0.0001 && Math.abs(z1 - z2) < 0.0001) return;
    const nx1 = quantizeValue(x1);
    const ny1 = quantizeValue(y1);
    const nz1 = quantizeValue(z1);
    const nx2 = quantizeValue(x2);
    const ny2 = quantizeValue(y2);
    const nz2 = quantizeValue(z2);
    const swap = nx1 > nx2 || (nx1 === nx2 && (ny1 > ny2 || (ny1 === ny2 && nz1 > nz2)));
    const ax1 = swap ? nx2 : nx1;
    const ay1 = swap ? ny2 : ny1;
    const az1 = swap ? nz2 : nz1;
    const ax2 = swap ? nx1 : nx2;
    const ay2 = swap ? ny1 : ny2;
    const az2 = swap ? nz1 : nz2;
    const key = `${ax1},${ay1},${az1}->${ax2},${ay2},${az2}`;
    const bucket = flowSegmentsByType.get(type) || new Map();
    const entry = bucket.get(key) || {
      x1: ax1,
      y1: ay1,
      z1: az1,
      x2: ax2,
      y2: ay2,
      z2: az2,
      weight: 0,
      dirSum: 0,
      rSum: 0,
      gSum: 0,
      bSum: 0,
      colorWeight: 0,
      endpoints: new Set()
    };
    const direction = Number.isFinite(dir) && dir !== 0 ? dir : 1;
    const normalizedDir = swap ? -direction : direction;
    entry.weight += weight;
    entry.dirSum += normalizedDir * weight;
    if (edge) {
      addEndpoint(entry, edge.from);
      addEndpoint(entry, edge.to);
    }
    if (color) {
      entry.rSum += color.r * weight;
      entry.gSum += color.g * weight;
      entry.bSum += color.b * weight;
      entry.colorWeight += weight;
    }
    bucket.set(key, entry);
    flowSegmentsByType.set(type, bucket);
  };

  return {
    flowSegmentsByType,
    addFlowSegment
  };
};

export const aggregateEdges = ({ edges, edgeWeights, fileColorByPath, resolveEdgeType, resolveEdgeFile, THREE }) => {
  const buckets = new Map();
  for (const edge of edges) {
    if (!edge) continue;
    const rawType = edge.type || 'other';
    const type = resolveEdgeType(rawType);
    const fromFile = resolveEdgeFile(edge.from);
    const toFile = resolveEdgeFile(edge.to);
    if (!fromFile || !toFile) continue;
    const key = `${type}:${fromFile}->${toFile}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        type,
        fromFile,
        toFile,
        weight: 0,
        color: new THREE.Color(0, 0, 0),
        colorWeight: 0
      };
      buckets.set(key, bucket);
    }
    bucket.weight += edgeWeights[type] || edgeWeights[rawType] || 1;
    const fromColor = fileColorByPath.get(fromFile);
    const toColor = fileColorByPath.get(toFile);
    const mixedColor = fromColor && toColor
      ? fromColor.clone().lerp(toColor, 0.5)
      : (fromColor || toColor || null);
    if (mixedColor) {
      bucket.color.add(mixedColor);
      bucket.colorWeight += 1;
    }
  }
  return Array.from(buckets.values()).map((bucket) => ({
    edge: { from: { file: bucket.fromFile }, to: { file: bucket.toFile }, type: bucket.type },
    type: bucket.type,
    fromFile: bucket.fromFile,
    toFile: bucket.toFile,
    weight: bucket.weight,
    edgeColor: bucket.colorWeight
      ? bucket.color.clone().multiplyScalar(1 / bucket.colorWeight)
      : null
  }));
};

export const aggregateEdgesFromStats = ({ edgeAggregates, fileColorByPath, resolveEdgeType }) => {
  if (!Array.isArray(edgeAggregates) || !edgeAggregates.length) return [];
  const entries = [];
  for (const entry of edgeAggregates) {
    if (!entry) continue;
    const rawType = entry.type || 'other';
    const type = resolveEdgeType(rawType);
    const fromFile = entry.fromFile || null;
    const toFile = entry.toFile || null;
    if (!fromFile || !toFile) continue;
    const fromColor = fileColorByPath.get(fromFile);
    const toColor = fileColorByPath.get(toFile);
    const mixedColor = fromColor && toColor
      ? fromColor.clone().lerp(toColor, 0.5)
      : (fromColor || toColor || null);
    entries.push({
      edge: { from: { file: fromFile }, to: { file: toFile }, type },
      type,
      fromFile,
      toFile,
      weight: Number.isFinite(entry.weight) ? entry.weight : (entry.count || 1),
      edgeColor: mixedColor || null,
      count: entry.count ?? null,
      minWeight: entry.minWeight ?? null,
      maxWeight: entry.maxWeight ?? null
    });
  }
  return entries;
};
