import { state } from './state.js';
import { clamp, numberValue } from './utils.js';
import {
  resolveShape,
  sizeFactor,
  memberSizeFromRange,
  groupKeyForPath,
  scoreMember,
  scoreToColor,
  computeGrid,
  buildSlots,
  orderByAdjacency,
  layoutGridItems,
  layoutRadialItems,
  layoutFlowItems,
  layoutDependencyLanes,
  layoutSpiralItems
} from './layout-utils.js';
import { DEFAULT_EDGE_WEIGHTS } from '../../constants.js';

export const createShapeGeometry = (shape) => {
  const { THREE } = state;
  const resolved = String(shape || 'square').toLowerCase();
  state.shapeGeometryCache = state.shapeGeometryCache || new Map();
  if (state.shapeGeometryCache.has(resolved)) {
    return state.shapeGeometryCache.get(resolved);
  }
  let geometry;
  if (resolved === 'circle') {
    geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 1, false);
  } else if (resolved === 'pyramid') {
    geometry = new THREE.CylinderGeometry(0.44, 0.62, 1, 4, 1, false);
  } else {
    geometry = new THREE.BoxGeometry(1, 1, 1);
  }
  geometry.userData = { ...(geometry.userData || {}), shared: true };
  state.shapeGeometryCache.set(resolved, geometry);
  return geometry;
};

export const computeLayout = () => {
  const {
    THREE,
    files,
    edges,
    layout,
    layoutDefaults,
    scoring,
    colors,
    scaleFactor,
    fileByMember
  } = state;

  const groupDepth = Math.max(0, Math.floor(numberValue(layout.groupDepth, layoutDefaults.groupDepth)));
  const baseSize = numberValue(layout.baseSize, layoutDefaults.baseSize) * scaleFactor;
  const fileHeight = numberValue(layout.fileHeight, layoutDefaults.fileHeight) * scaleFactor * 2;
  const memberCell = numberValue(layout.memberCell, layoutDefaults.memberCell) * scaleFactor;
  const memberGap = numberValue(layout.memberGap, layoutDefaults.memberGap) * scaleFactor;
  const memberInset = numberValue(layout.memberInset, layoutDefaults.memberInset) * scaleFactor;
  const fileSpacing = numberValue(layout.fileSpacing ?? layout.spacing, layoutDefaults.fileSpacing) * scaleFactor;
  const groupSpacing = numberValue(layout.groupSpacing, layoutDefaults.groupSpacing) * scaleFactor;
  const compactness = numberValue(layout.compactness, layoutDefaults.compactness);
  const routingPadding = numberValue(layout.routingPadding, layoutDefaults.routingPadding) * scaleFactor;
  const routingStep = numberValue(layout.routingStep, layoutDefaults.routingStep) * scaleFactor;
  const labelScale = numberValue(layout.labelScale, layoutDefaults.labelScale) * scaleFactor;
  const labelOffset = numberValue(layout.labelOffset, layoutDefaults.labelOffset) * scaleFactor;
  const edgePlane = numberValue(layout.edgePlane, layoutDefaults.edgePlane) * scaleFactor;
  const memberHeightBase = numberValue(layout.memberHeightBase, layoutDefaults.memberHeightBase) * scaleFactor;
  const memberHeightScale = numberValue(layout.memberHeightScale, layoutDefaults.memberHeightScale) * scaleFactor;
  const memberHeightMax = numberValue(layout.memberHeightMax, layoutDefaults.memberHeightMax) * scaleFactor;

  const edgeWeights = DEFAULT_EDGE_WEIGHTS;

  const resolveEdgeFile = (endpoint) => {
    if (!endpoint) return null;
    if (endpoint.file) return endpoint.file;
    if (endpoint.member) return fileByMember.get(endpoint.member) || null;
    return null;
  };

  const fileAdjacency = new Map();
  const fileAdjacencyDirected = new Map();
  const groupAdjacency = new Map();
  const groupAdjacencyDirected = new Map();
  const touchAdjacency = (mapRef, from, to, weight) => {
    if (!from || !to || from === to) return;
    const bucket = mapRef.get(from) || new Map();
    bucket.set(to, (bucket.get(to) || 0) + weight);
    mapRef.set(from, bucket);
  };

  const groupKeyByFile = new Map();
  const surfaceScaleForShape = (shape) => {
    if (shape === 'pyramid') return 0.78;
    if (shape === 'circle') return 0.92;
    return 1;
  };

  for (const node of files) {
    const key = groupKeyForPath(node.path || node.name || '', groupDepth);
    groupKeyByFile.set(node.path, key);
  }
  for (const edge of edges) {
    const fromFile = resolveEdgeFile(edge.from);
    const toFile = resolveEdgeFile(edge.to);
    if (!fromFile || !toFile) continue;
    const weight = edgeWeights[edge.type] || 1;
    touchAdjacency(fileAdjacency, fromFile, toFile, weight);
    touchAdjacency(fileAdjacency, toFile, fromFile, weight);
    touchAdjacency(fileAdjacencyDirected, fromFile, toFile, weight);
    const fromGroup = groupKeyByFile.get(fromFile);
    const toGroup = groupKeyByFile.get(toFile);
    if (fromGroup && toGroup) {
      touchAdjacency(groupAdjacency, fromGroup, toGroup, weight);
      touchAdjacency(groupAdjacency, toGroup, fromGroup, weight);
      touchAdjacency(groupAdjacencyDirected, fromGroup, toGroup, weight);
    }
  }

  const groupsByKey = new Map();
  let maxMemberScore = 0;
  let maxFileScore = 0;

  for (const node of files) {
    const members = Array.isArray(node.members) ? node.members : [];
    const membersWithMetrics = members.map((member) => {
      const score = scoreMember(member, scoring);
      const size = memberSizeFromRange(member.range);
      maxMemberScore = Math.max(maxMemberScore, score);
      const sizeScale = sizeFactor(size, 0.75, 0.12, 0.7, 1.35);
      const scoreScale = sizeFactor(score, 0.65, 0.08, 0.8, 1.8);
      return {
        member,
        score,
        size,
        footprintScale: clamp(sizeScale * scoreScale, 0.8, 3.2),
        heightScale: clamp(
          sizeFactor(size, 0.85, 0.18, 0.75, 1.6) * sizeFactor(score, 0.7, 0.08, 0.85, 2),
          0.8,
          2.6
        )
      };
    });
    const fileSize = membersWithMetrics.reduce((acc, entry) => acc + entry.size, 0)
      || members.length
      || 1;
    const fileSizeScale = sizeFactor(fileSize, 0.8, 0.12, 0.75, 2.3);
    const fileShape = resolveShape(layout.fileShape || layoutDefaults.fileShape, {
      key: node.path || node.name,
      category: node.category
    });
    const grid = computeGrid(members.length);
    const maxFootprintScale = membersWithMetrics.reduce((acc, entry) => Math.max(acc, entry.footprintScale), 1);
    const cellSize = memberCell * maxFootprintScale;
    const cellGap = memberGap * maxFootprintScale;
    let width = baseSize;
    let depth = baseSize;
    if (members.length) {
      width = Math.max(baseSize, grid.columns * cellSize + (grid.columns - 1) * cellGap + memberInset * 2);
      depth = Math.max(baseSize, grid.rows * cellSize + (grid.rows - 1) * cellGap + memberInset * 2);
    }
    const fileScore = membersWithMetrics.reduce((acc, entry) => acc + entry.score, 0);
    maxFileScore = Math.max(maxFileScore, fileScore);
    const fileScoreScale = sizeFactor(fileScore, 0.85, 0.08, 0.85, 1.9);
    width *= fileSizeScale * fileScoreScale;
    depth *= fileSizeScale * fileScoreScale;
    const fileHeightBoost = Math.min(6, Math.log1p(fileScore) * 0.35) * scaleFactor;
    const fileHeightScale = sizeFactor(fileSize, 0.9, 0.08, 0.85, 1.5);
    const fileComplexityScale = sizeFactor(fileScore, 0.85, 0.06, 0.9, 1.7);
    const surfaceScale = surfaceScaleForShape(fileShape);
    const surfaceWidth = width * surfaceScale;
    const surfaceDepth = depth * surfaceScale;
    const surfaceInset = memberInset * surfaceScale;
    const fileHeightValue = (fileHeight + fileHeightBoost) * fileHeightScale * fileComplexityScale;
    const fileLayout = {
      node,
      width,
      depth,
      height: fileHeightValue,
      topY: fileHeightValue,
      surfaceScale,
      surfaceWidth,
      surfaceDepth,
      score: fileScore,
      shape: fileShape,
      columns: grid.columns,
      rows: grid.rows,
      cellSize,
      cellGap,
      memberSlots: buildSlots(
        surfaceWidth,
        surfaceDepth,
        grid.columns,
        grid.rows,
        cellSize,
        cellGap,
        surfaceInset,
        memberCell,
        memberGap
      ),
      members: membersWithMetrics.map((entry) => {
        const rawHeight = memberHeightBase + scoreMember(entry.member, scoring) * memberHeightScale;
        const clampedHeight = Math.max(memberHeightBase, Math.min(memberHeightMax, rawHeight));
        return {
          member: entry.member,
          score: entry.score,
          size: entry.size,
          shape: resolveShape(layout.memberShape || layoutDefaults.memberShape, {
            key: entry.member.id || entry.member.name,
            type: entry.member.type
          }),
          footprint: memberCell * entry.footprintScale,
          height: clampedHeight * entry.heightScale
        };
      })
    };
    const key = groupKeyForPath(node.path || node.name || '', groupDepth);
    const group = groupsByKey.get(key) || { key, files: [] };
    group.files.push(fileLayout);
    groupsByKey.set(key, group);
  }

  const layoutStyle = String(layout.style || layoutDefaults.style || 'clustered').toLowerCase();
  const groups = orderByAdjacency(
    Array.from(groupsByKey.values()),
    (group) => group.key,
    groupAdjacency
  );

  for (const group of groups) {
    group.files = orderByAdjacency(
      group.files,
      (file) => file.node.path || file.node.name || '',
      fileAdjacency
    );
    if (layoutStyle === 'radial') {
      const metrics = layoutRadialItems(group.files, fileSpacing);
      group.width = Math.max(baseSize, metrics.width);
      group.depth = Math.max(baseSize, metrics.depth);
    } else {
      const columns = Math.max(1, Math.ceil(Math.sqrt(group.files.length || 1)));
      const metrics = layoutGridItems(group.files, columns, fileSpacing);
      group.width = Math.max(baseSize, metrics.width);
      group.depth = Math.max(baseSize, metrics.depth);
    }
  }

  const allFiles = groups.flatMap((group) => group.files);

  if (layoutStyle === 'stream') {
    const orderedFiles = orderByAdjacency(
      allFiles,
      (file) => file.node.path || file.node.name || '',
      fileAdjacency
    );
    let cursorX = 0;
    let cursorZ = 0;
    orderedFiles.forEach((fileLayout) => {
      fileLayout.x = cursorX;
      fileLayout.z = cursorZ;
      cursorX += fileLayout.width + fileSpacing;
      cursorZ += fileLayout.depth * 0.6 + fileSpacing * 0.6;
    });
  } else if (layoutStyle === 'flat' || layoutStyle === 'grid') {
    const orderedFiles = orderByAdjacency(
      allFiles,
      (file) => file.node.path || file.node.name || '',
      fileAdjacency
    );
    const columns = Math.max(1, Math.ceil(Math.sqrt(orderedFiles.length || 1)));
    layoutGridItems(orderedFiles, columns, fileSpacing);
  } else if (layoutStyle === 'radial') {
    const groupRadii = groups.map((group) => Math.max(group.width || 0, group.depth || 0) / 2);
    const maxGroupRadius = groupRadii.reduce((acc, value) => Math.max(acc, value), baseSize / 2);
    const circumference = groupRadii.reduce((acc, value) => acc + (value * 2 + groupSpacing), 0);
    const baseRadius = Math.max(maxGroupRadius * 2.2, circumference / (2 * Math.PI));
    let angle = 0;
    groups.forEach((group, index) => {
      const arc = (groupRadii[index] * 2 + groupSpacing) / baseRadius;
      angle += arc / 2;
      const offsetX = Math.cos(angle) * baseRadius;
      const offsetZ = Math.sin(angle) * baseRadius;
      for (const fileLayout of group.files) {
        fileLayout.x += offsetX;
        fileLayout.z += offsetZ;
      }
      angle += arc / 2;
    });
  } else if (layoutStyle === 'flow') {
    const orderedFiles = orderByAdjacency(
      allFiles,
      (file) => file.node.path || file.node.name || '',
      fileAdjacency
    );
    layoutFlowItems(
      orderedFiles,
      fileSpacing,
      fileAdjacency,
      (file) => file.node.path || file.node.name || ''
    );
  } else if (layoutStyle === 'lanes' || layoutStyle === 'dependency' || layoutStyle === 'dependencies') {
    const orderedFiles = orderByAdjacency(
      allFiles,
      (file) => file.node.path || file.node.name || '',
      fileAdjacencyDirected
    );
    layoutDependencyLanes(
      orderedFiles,
      fileSpacing,
      fileAdjacencyDirected,
      (file) => file.node.path || file.node.name || ''
    );
  } else if (layoutStyle === 'spiral') {
    const orderedFiles = orderByAdjacency(
      allFiles,
      (file) => file.node.path || file.node.name || '',
      fileAdjacency
    );
    layoutSpiralItems(orderedFiles, fileSpacing);
  } else {

    const groupCount = Math.max(1, groups.length);
    const groupColumns = Math.ceil(Math.sqrt(groupCount));
    const groupLayouts = groups.map((group) => ({
      width: group.width || baseSize,
      depth: group.depth || baseSize,
      x: 0,
      z: 0
    }));
    layoutGridItems(groupLayouts, groupColumns, groupSpacing);
    groups.forEach((group, index) => {
      const offsetX = groupLayouts[index].x;
      const offsetZ = groupLayouts[index].z;
      for (const fileLayout of group.files) {
        fileLayout.x += offsetX;
        fileLayout.z += offsetZ;
      }
    });
  }

  let minX = 0;
  let maxX = 0;
  let minZ = 0;
  let maxZ = 0;
  if (allFiles.length) {
    minX = Infinity;
    maxX = -Infinity;
    minZ = Infinity;
    maxZ = -Infinity;
    for (const fileLayout of allFiles) {
      const left = fileLayout.x - fileLayout.width / 2;
      const right = fileLayout.x + fileLayout.width / 2;
      const back = fileLayout.z - fileLayout.depth / 2;
      const front = fileLayout.z + fileLayout.depth / 2;
      minX = Math.min(minX, left);
      maxX = Math.max(maxX, right);
      minZ = Math.min(minZ, back);
      maxZ = Math.max(maxZ, front);
    }
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    for (const fileLayout of allFiles) {
      fileLayout.x -= centerX;
      fileLayout.z -= centerZ;
    }
    minX -= centerX;
    maxX -= centerX;
    minZ -= centerZ;
    maxZ -= centerZ;
  }

  if (Number.isFinite(compactness) && compactness > 0 && compactness !== 1) {
    for (const fileLayout of allFiles) {
      fileLayout.x *= compactness;
      fileLayout.z *= compactness;
    }
    minX *= compactness;
    maxX *= compactness;
    minZ *= compactness;
    maxZ *= compactness;
  }

  const spanX = Math.max(40, maxX - minX);
  const spanZ = Math.max(40, maxZ - minZ);
  const maxSpan = Math.max(spanX, spanZ);

  Object.assign(state, {
    layoutStyle,
    layoutMetrics: {
      groupDepth,
      baseSize,
      fileHeight,
      memberCell,
      memberGap,
      memberInset,
      fileSpacing,
      groupSpacing,
      compactness,
      routingPadding,
      routingStep,
      labelScale,
      labelOffset,
      edgePlane
    },
    edgeWeights,
    groupKeyByFile,
    fileAdjacency,
    groupAdjacency,
    groups,
    allFiles,
    maxMemberScore,
    maxFileScore,
    bounds: { minX, maxX, minZ, maxZ, spanX, spanZ, maxSpan },
    resolveShape,
    scoreToColor: (score, key) => scoreToColor(score, maxMemberScore, colors, THREE, key)
  });
};
