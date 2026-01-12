import { clamp, hashString } from './utils.js';

const shapeForCategory = {
  source: 'hexagon',
  test: 'pentagon-pyramid',
  config: 'octagon',
  docs: 'heptagon',
  generated: 'square',
  dir: 'pentagon',
  other: 'square'
};

const shapeForMemberType = {
  class: 'pyramid',
  function: 'hexagon-pyramid',
  symbol: 'square'
};

const knownShapes = new Set([
  'square',
  'circle',
  'pyramid',
  'pentagon',
  'hexagon',
  'heptagon',
  'octagon',
  'pentagon-pyramid',
  'hexagon-pyramid',
  'heptagon-pyramid',
  'octagon-pyramid',
  'pentagon-frustum',
  'hexagon-frustum',
  'heptagon-frustum',
  'octagon-frustum'
]);

export const resolveShape = (mode, { key, category, type } = {}) => {
  const normalized = String(mode || 'square').toLowerCase();
  if (normalized === 'category') {
    if (category && shapeForCategory[category]) return shapeForCategory[category];
    if (type && shapeForMemberType[type]) return shapeForMemberType[type];
    return 'square';
  }
  if (normalized === 'mix') {
    const mixSeed = hashString(key || category || type || '');
    if (mixSeed < 0.2) return 'square';
    if (mixSeed < 0.4) return 'circle';
    if (mixSeed < 0.6) return 'pyramid';
    if (mixSeed < 0.75) return 'hexagon';
    if (mixSeed < 0.9) return 'pentagon';
    return 'octagon';
  }
  if (knownShapes.has(normalized)) {
    return normalized;
  }
  return 'square';
};

export const sizeFactor = (value, base, scale, min, max) => {
  const normalized = base + Math.log1p(Math.max(0, value)) * scale;
  return clamp(normalized, min, max);
};

export const memberSizeFromRange = (range) => {
  if (!range || !Number.isFinite(range.startLine)) return 1;
  const start = range.startLine;
  const end = Number.isFinite(range.endLine) ? range.endLine : start;
  return Math.max(1, end - start + 1);
};

const splitPath = (value) => String(value || '').split('/').filter(Boolean);

export const groupKeyForPath = (filePath, groupDepth) => {
  const segments = splitPath(filePath);
  if (!segments.length || groupDepth === 0) return '(root)';
  return segments.slice(0, groupDepth).join('/');
};

export const scoreMember = (member, scoring) => {
  let score = 0;
  const dataflow = member?.dataflow || {};
  const flowLists = [dataflow.reads, dataflow.writes, dataflow.mutations, dataflow.aliases];
  for (const list of flowLists) {
    if (Array.isArray(list)) score += list.length * scoring.dataflow;
  }
  const control = member?.controlFlow || {};
  for (const value of Object.values(control)) {
    if (Array.isArray(value)) score += value.length * scoring.controlFlow;
    else if (typeof value === 'number') score += value * scoring.controlFlow;
    else if (value) score += 1 * scoring.controlFlow;
  }
  if (Array.isArray(member?.params)) score += member.params.length * scoring.params;
  if (member?.signature) score += Math.min(10, String(member.signature).length / 20) * scoring.signature;
  if (member?.returns) score += 1 * scoring.returns;
  if (member?.exported) score += 1 * scoring.exported;
  if (member?.modifiers && typeof member.modifiers === 'object') {
    score += Object.keys(member.modifiers).length * scoring.modifiers;
  }
  const kind = String(member?.kind || member?.type || '').toLowerCase();
  if (kind.includes('class') || kind.includes('interface') || kind.includes('struct')) score += scoring.type;
  return score;
};

export const scoreToColor = (score, maxScore, colors, THREE, key) => {
  const mode = String(colors.mode || 'score').toLowerCase();
  const color = new THREE.Color();
  if (mode === 'distinct') {
    const seed = hashString(key || score || '');
    const normalized = seed / 0xffffffff;
    const hue = (normalized + (colors.distinctHueOffset || 0)) % 1;
    const saturation = colors.distinctSaturation ?? colors.saturation ?? 0.7;
    const lightness = colors.distinctLightness ?? colors.lightnessMax ?? 0.6;
    color.setHSL(hue, saturation, lightness);
    return color;
  }
  const ratio = maxScore > 0
    ? Math.log10(score + 1) / Math.log10(maxScore + 1)
    : 0;
  const hue = colors.hueStart + (colors.hueEnd - colors.hueStart) * ratio;
  const lightness = colors.lightnessMin + (colors.lightnessMax - colors.lightnessMin) * ratio;
  color.setHSL(hue, colors.saturation, lightness);
  return color;
};

export const computeGrid = (count) => {
  if (!count) return { columns: 0, rows: 0 };
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  return { columns, rows };
};

export const buildSlots = (width, depth, columns, rows, cellSize, gap, memberInset, memberCell, memberGap) => {
  if (!columns || !rows) return [];
  const slots = [];
  const resolvedCell = cellSize || memberCell;
  const resolvedGap = Number.isFinite(gap) ? gap : memberGap;
  const startX = -width / 2 + memberInset + resolvedCell / 2;
  const startZ = -depth / 2 + memberInset + resolvedCell / 2;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const x = startX + col * (resolvedCell + resolvedGap);
      const z = startZ + row * (resolvedCell + resolvedGap);
      slots.push({ x, z, sort: x + z });
    }
  }
  return slots.sort((a, b) => (a.sort - b.sort) || (a.x - b.x) || (a.z - b.z));
};

export const orderByAdjacency = (items, getKey, adjacency) => {
  if (!items.length) return [];
  if (items.length === 1) return items.slice();
  const keys = items.map(getKey);
  const totalWeight = new Map();
  keys.forEach((key) => {
    const neighbors = adjacency.get(key) || new Map();
    let total = 0;
    for (const value of neighbors.values()) total += value;
    totalWeight.set(key, total);
  });
  const remaining = new Set(keys);
  const orderedKeys = [];
  let current = keys.slice().sort((a, b) => {
    const diff = (totalWeight.get(b) || 0) - (totalWeight.get(a) || 0);
    return diff || a.localeCompare(b);
  })[0];
  orderedKeys.push(current);
  remaining.delete(current);
  while (remaining.size) {
    let best = null;
    let bestScore = -1;
    for (const key of remaining) {
      const neighbors = adjacency.get(key) || new Map();
      let score = 0;
      for (const placed of orderedKeys) {
        score += neighbors.get(placed) || 0;
      }
      score += (totalWeight.get(key) || 0) * 0.1;
      if (score > bestScore) {
        bestScore = score;
        best = key;
      } else if (score === bestScore && best && key.localeCompare(best) < 0) {
        best = key;
      }
    }
    orderedKeys.push(best);
    remaining.delete(best);
  }
  const itemByKey = new Map(items.map((item) => [getKey(item), item]));
  return orderedKeys.map((key) => itemByKey.get(key)).filter(Boolean);
};

export const layoutGridItems = (items, columns, spacing) => {
  const count = items.length;
  if (!count) return { width: 0, depth: 0, columns: 0, rows: 0 };
  const cols = Math.max(1, columns || 1);
  const rows = Math.max(1, Math.ceil(count / cols));
  const colWidths = Array.from({ length: cols }, () => 0);
  const rowDepths = Array.from({ length: rows }, () => 0);
  items.forEach((item, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    colWidths[col] = Math.max(colWidths[col], item.width || 0);
    rowDepths[row] = Math.max(rowDepths[row], item.depth || 0);
  });
  const colOffsets = [];
  const rowOffsets = [];
  let offsetX = 0;
  for (let col = 0; col < cols; col += 1) {
    colOffsets[col] = offsetX;
    offsetX += colWidths[col] + spacing;
  }
  let offsetZ = 0;
  for (let row = 0; row < rows; row += 1) {
    rowOffsets[row] = offsetZ;
    offsetZ += rowDepths[row] + spacing;
  }
  items.forEach((item, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const xPad = (colWidths[col] - item.width) / 2;
    const zPad = (rowDepths[row] - item.depth) / 2;
    item.x = colOffsets[col] + xPad;
    item.z = rowOffsets[row] + zPad;
  });
  const totalWidth = colWidths.reduce((acc, value) => acc + value, 0) + spacing * (cols - 1);
  const totalDepth = rowDepths.reduce((acc, value) => acc + value, 0) + spacing * (rows - 1);
  return { width: totalWidth, depth: totalDepth, columns: cols, rows };
};

export const layoutRadialItems = (items, spacing) => {
  const count = items.length;
  if (!count) return { width: 0, depth: 0 };
  if (count === 1) {
    items[0].x = 0;
    items[0].z = 0;
    return { width: items[0].width || 0, depth: items[0].depth || 0 };
  }
  const radii = items.map((item) => Math.max(item.width || 0, item.depth || 0) / 2);
  const maxRadius = radii.reduce((acc, value) => Math.max(acc, value), 0);
  const circumference = radii.reduce((acc, value) => acc + (value * 2 + spacing), 0);
  const baseRadius = Math.max(maxRadius * 1.5, circumference / (2 * Math.PI));
  let angle = 0;
  items.forEach((item, index) => {
    const arc = (radii[index] * 2 + spacing) / baseRadius;
    angle += arc / 2;
    item.x = Math.cos(angle) * baseRadius;
    item.z = Math.sin(angle) * baseRadius;
    angle += arc / 2;
  });
  const extent = baseRadius + maxRadius;
  return { width: extent * 2, depth: extent * 2 };
};

export const layoutHexItems = (items, spacing) => {
  const count = items.length;
  if (!count) return { width: 0, depth: 0, columns: 0, rows: 0 };
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / cols));
  const maxWidth = items.reduce((acc, item) => Math.max(acc, item.width || 0), 0);
  const maxDepth = items.reduce((acc, item) => Math.max(acc, item.depth || 0), 0);
  const cellWidth = maxWidth + spacing;
  const cellDepth = maxDepth + spacing;
  const rowStep = cellDepth * 0.86;
  items.forEach((item, index) => {
    const row = Math.floor(index / cols);
    const col = index % cols;
    const offset = (row % 2) * cellWidth * 0.5;
    item.x = col * cellWidth + offset;
    item.z = row * rowStep;
  });
  const totalWidth = cellWidth * cols + cellWidth * 0.5;
  const totalDepth = rowStep * Math.max(1, rows - 1) + maxDepth;
  return { width: totalWidth, depth: totalDepth, columns: cols, rows };
};

export const layoutFlowItems = (items, spacing, adjacency, getKey) => {
  const count = items.length;
  if (!count) return { width: 0, depth: 0 };
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  layoutGridItems(items, columns, spacing);

  const indexByKey = new Map(items.map((item, index) => [getKey(item), index]));
  const neighbors = items.map(() => []);
  items.forEach((item, index) => {
    const key = getKey(item);
    const adjacent = adjacency.get(key) || new Map();
    for (const [targetKey, weight] of adjacent.entries()) {
      const targetIndex = indexByKey.get(targetKey);
      if (targetIndex === undefined) continue;
      neighbors[index].push({ index: targetIndex, weight: weight || 1 });
    }
  });

  const positions = items.map((item) => ({ x: item.x || 0, z: item.z || 0 }));
  const velocities = items.map(() => ({ x: 0, z: 0 }));
  const iterations = Math.min(80, 20 + count);
  const repulse = 0.35;
  const attract = 0.04;
  const damping = 0.75;
  const minSpacing = Math.max(0.6, spacing * 0.8);
  const maxVelocity = Math.max(minSpacing, spacing * 1.2);

  for (let iter = 0; iter < iterations; iter += 1) {
    for (let i = 0; i < count; i += 1) {
      let fx = 0;
      let fz = 0;
      const a = items[i];
      const posA = positions[i];
      for (let j = i + 1; j < count; j += 1) {
        const b = items[j];
        const posB = positions[j];
        const dx = posB.x - posA.x;
        const dz = posB.z - posA.z;
        const dist = Math.sqrt(dx * dx + dz * dz) || 0.0001;
        const target = (a.width + b.width) * 0.5 + minSpacing;
        const overlap = target - dist;
        if (overlap > 0) {
          const push = overlap * repulse;
          const rx = (dx / dist) * push;
          const rz = (dz / dist) * push;
          fx -= rx;
          fz -= rz;
          velocities[j].x += rx;
          velocities[j].z += rz;
        }
      }
      for (const neighbor of neighbors[i]) {
        const b = items[neighbor.index];
        const posB = positions[neighbor.index];
        const dx = posB.x - posA.x;
        const dz = posB.z - posA.z;
        const dist = Math.sqrt(dx * dx + dz * dz) || 0.0001;
        const target = (a.width + b.width) * 0.4 + spacing * 0.6;
        // Keep attraction pulling toward the target distance to avoid runaway layouts.
        const pull = (target - dist) * attract * Math.min(3, neighbor.weight || 1);
        fx += (dx / dist) * pull;
        fz += (dz / dist) * pull;
      }
      velocities[i].x = (velocities[i].x + fx) * damping;
      velocities[i].z = (velocities[i].z + fz) * damping;
      const speed = Math.hypot(velocities[i].x, velocities[i].z);
      if (speed > maxVelocity) {
        // Clamp velocity to avoid unstable layouts that can explode the bounds.
        const scale = maxVelocity / speed;
        velocities[i].x *= scale;
        velocities[i].z *= scale;
      }
    }
    for (let i = 0; i < count; i += 1) {
      positions[i].x += velocities[i].x;
      positions[i].z += velocities[i].z;
    }
  }

  items.forEach((item, index) => {
    item.x = positions[index].x;
    item.z = positions[index].z;
  });

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  items.forEach((item) => {
    minX = Math.min(minX, item.x - item.width / 2);
    maxX = Math.max(maxX, item.x + item.width / 2);
    minZ = Math.min(minZ, item.z - item.depth / 2);
    maxZ = Math.max(maxZ, item.z + item.depth / 2);
  });
  return { width: Math.max(0, maxX - minX), depth: Math.max(0, maxZ - minZ) };
};
