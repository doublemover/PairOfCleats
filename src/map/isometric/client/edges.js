import { state } from './state.js';
import { applyHeightFog, updateFlowLights } from './materials.js';

const quantize = (value) => Number(value.toFixed(3));

export const buildEdges = () => {
  const {
    THREE,
    edges,
    allFiles,
    layoutMetrics,
    edgeWeights,
    edgeGroup,
    edgeVisibility,
    flowTypeProfiles,
    fileAnchors,
    memberAnchors,
    fileByMember,
    memberColorById,
    fileColorByPath,
    visuals
  } = state;

  const edgePlane = layoutMetrics.edgePlane;
  const routingPadding = layoutMetrics.routingPadding;
  const routingStep = layoutMetrics.routingStep;
  const allowFlowLights = visuals.enableFlowLights !== false;

  const resolveEdgeFile = (endpoint) => {
    if (!endpoint) return null;
    if (endpoint.file) return endpoint.file;
    if (endpoint.member) return fileByMember.get(endpoint.member) || null;
    return null;
  };

  const resolveEdgeColor = (endpoint) => {
    if (!endpoint) return null;
    if (endpoint.member && memberColorById.has(endpoint.member)) {
      return memberColorById.get(endpoint.member);
    }
    if (endpoint.file && fileColorByPath.has(endpoint.file)) {
      return fileColorByPath.get(endpoint.file);
    }
    const fileKey = resolveEdgeFile(endpoint);
    if (fileKey && fileColorByPath.has(fileKey)) {
      return fileColorByPath.get(fileKey);
    }
    return null;
  };

  const obstacles = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const fileLayout of allFiles) {
    const fileId = fileLayout.node.path || fileLayout.node.name || null;
    if (!fileId) continue;
    const bounds = {
      file: fileId,
      minX: fileLayout.x - fileLayout.width / 2 - routingPadding,
      maxX: fileLayout.x + fileLayout.width / 2 + routingPadding,
      minZ: fileLayout.z - fileLayout.depth / 2 - routingPadding,
      maxZ: fileLayout.z + fileLayout.depth / 2 + routingPadding
    };
    obstacles.push(bounds);
    minX = Math.min(minX, bounds.minX);
    maxX = Math.max(maxX, bounds.maxX);
    minZ = Math.min(minZ, bounds.minZ);
    maxZ = Math.max(maxZ, bounds.maxZ);
  }

  const resolveAnchor = (endpoint) => {
    if (!endpoint) return null;

    const memberId = endpoint.member === 0 || endpoint.member ? String(endpoint.member) : null;
    if (memberId && memberAnchors.has(memberId)) return memberAnchors.get(memberId);

    if (endpoint.file && fileAnchors.has(endpoint.file)) return fileAnchors.get(endpoint.file);
    return null;
  };

  const segmentHitsObstacle = (x1, z1, x2, z2, ignoreFiles) => {
    const minXSeg = Math.min(x1, x2);
    const maxXSeg = Math.max(x1, x2);
    const minZSeg = Math.min(z1, z2);
    const maxZSeg = Math.max(z1, z2);
    const isVertical = Math.abs(x1 - x2) < 0.0001;
    const isHorizontal = Math.abs(z1 - z2) < 0.0001;
    for (const obstacle of obstacles) {
      if (ignoreFiles && ignoreFiles.has(obstacle.file)) continue;
      if (isVertical) {
        if (x1 < obstacle.minX || x1 > obstacle.maxX) continue;
        if (maxZSeg < obstacle.minZ || minZSeg > obstacle.maxZ) continue;
        return true;
      }
      if (isHorizontal) {
        if (z1 < obstacle.minZ || z1 > obstacle.maxZ) continue;
        if (maxXSeg < obstacle.minX || minXSeg > obstacle.maxX) continue;
        return true;
      }
      if (maxXSeg < obstacle.minX || minXSeg > obstacle.maxX || maxZSeg < obstacle.minZ || minZSeg > obstacle.maxZ) continue;
      return true;
    }
    return false;
  };

  const buildLaneValues = (min, max, step) => {
    const values = [];
    if (!step || step <= 0) return values;
    const start = Math.floor(min / step) * step;
    const end = Math.ceil(max / step) * step;
    for (let value = start; value <= end; value += step) {
      values.push(Number(value.toFixed(3)));
    }
    return values;
  };

  const findRoute = (start, end, ignoreFiles) => {
    let bestPoints = null;
    let bestDistance = Infinity;
    const tryPath = (points) => {
      for (let i = 0; i < points.length - 1; i += 1) {
        const a = points[i];
        const b = points[i + 1];
        if (segmentHitsObstacle(a.x, a.z, b.x, b.z, ignoreFiles)) return false;
      }
      let distance = 0;
      for (let i = 0; i < points.length - 1; i += 1) {
        const a = points[i];
        const b = points[i + 1];
        distance += Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
      }
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPoints = points;
      }
      return true;
    };

    const directA = [start, { x: end.x, z: start.z }, end];
    const directB = [start, { x: start.x, z: end.z }, end];
    const directAOk = tryPath(directA);
    const directBOk = tryPath(directB);
    if (directAOk || directBOk) {
      return bestPoints || directA;
    }

    const laneZ = buildLaneValues(minZ - routingPadding, maxZ + routingPadding, routingStep);
    for (const z of laneZ) {
      tryPath([start, { x: start.x, z }, { x: end.x, z }, end]);
    }
    const laneX = buildLaneValues(minX - routingPadding, maxX + routingPadding, routingStep);
    for (const x of laneX) {
      tryPath([start, { x, z: start.z }, { x, z: end.z }, end]);
    }

    return bestPoints || directA;
  };

  const flowSegmentsByType = new Map();
  const flowLightCandidates = [];
  const edgeStyles = state.map.legend?.edgeStyles || {};
  const edgeTypeAliases = state.map.legend?.edgeTypes || {};
  const resolveEdgeType = (type) => (edgeStyles[type] ? type : (edgeTypeAliases[type] || type));
  const resolveEdgeStyle = (type) => edgeStyles[resolveEdgeType(type)] || edgeStyles[type] || {};
  const addEndpoint = (entry, endpoint) => {
    if (!endpoint) return;
    if (endpoint.member) {
      entry.endpoints.add(`member:${endpoint.member}`);
      const memberFile = fileByMember.get(endpoint.member);
      if (memberFile) entry.endpoints.add(`file:${memberFile}`);
    }
    if (endpoint.file) {
      entry.endpoints.add(`file:${endpoint.file}`);
    }
  };

  const addFlowSegment = (type, x1, z1, x2, z2, weight, color, dir, edge) => {
    if (Math.abs(x1 - x2) < 0.0001 && Math.abs(z1 - z2) < 0.0001) return;
    const nx1 = quantize(x1);
    const nz1 = quantize(z1);
    const nx2 = quantize(x2);
    const nz2 = quantize(z2);
    const swap = nx1 > nx2 || (nx1 === nx2 && nz1 > nz2);
    const ax1 = swap ? nx2 : nx1;
    const az1 = swap ? nz2 : nz1;
    const ax2 = swap ? nx1 : nx2;
    const az2 = swap ? nz1 : nz2;
    const key = `${ax1},${az1}->${ax2},${az2}`;
    const bucket = flowSegmentsByType.get(type) || new Map();
    const entry = bucket.get(key) || {
      x1: ax1,
      z1: az1,
      x2: ax2,
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

  const edgeHighlight = new THREE.Color('#ffffff');
  for (const edge of edges) {
    const startAnchor = resolveAnchor(edge.from);
    const endAnchor = resolveAnchor(edge.to);
    if (!startAnchor || !endAnchor) continue;
    const fromFile = resolveEdgeFile(edge.from);
    const toFile = resolveEdgeFile(edge.to);
    const ignoreFiles = new Set([fromFile, toFile].filter(Boolean));
    const start = { x: startAnchor.x, z: startAnchor.z };
    const end = { x: endAnchor.x, z: endAnchor.z };
    const points = findRoute(start, end, ignoreFiles);
    const rawType = edge.type || 'other';
    const type = resolveEdgeType(rawType);
    const weight = edgeWeights[type] || edgeWeights[rawType] || 1;
    const fromColor = resolveEdgeColor(edge.from);
    const toColor = resolveEdgeColor(edge.to);
    let edgeColor = null;
    if (fromColor && toColor) {
      edgeColor = fromColor.clone().lerp(toColor, 0.5);
    } else {
      edgeColor = fromColor || toColor || null;
    }
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      const dir = Math.abs(b.x - a.x) > Math.abs(b.z - a.z)
        ? Math.sign(b.x - a.x)
        : Math.sign(b.z - a.z);
      addFlowSegment(type, a.x, a.z, b.x, b.z, weight, edgeColor, dir, edge);
    }
  }

  const localEdgeTypeGroups = new Map();
  for (const [type, segments] of flowSegmentsByType.entries()) {
    if (!segments.size) continue;
    const group = new THREE.Group();
    edgeGroup.add(group);
    localEdgeTypeGroups.set(type, group);
    if (edgeVisibility.has(type)) {
      group.visible = edgeVisibility.get(type);
    }
    const style = resolveEdgeStyle(type);
    const typeProfile = flowTypeProfiles[type] || flowTypeProfiles.other;
    const fallbackColor = new THREE.Color(style.color || '#9aa0a6');
    for (const entry of segments.values()) {
      const dx = entry.x2 - entry.x1;
      const dz = entry.z2 - entry.z1;
      const length = Math.max(Math.abs(dx), Math.abs(dz));
      if (!length) continue;
      const thickness = 0.08 + Math.log1p(entry.weight) * 0.04;
      const colorWeight = entry.colorWeight || 0;
      const averaged = colorWeight
        ? new THREE.Color(entry.rSum / colorWeight, entry.gSum / colorWeight, entry.bSum / colorWeight)
        : fallbackColor.clone();
      const edgeBase = style.color ? new THREE.Color(style.color) : averaged;
      const darkColor = edgeBase.clone().multiplyScalar(0.32);
      const brightColor = edgeBase.clone().lerp(edgeHighlight, 0.25);
      const direction = entry.dirSum >= 0 ? 1 : -1;
      const geometry = state.edgeUnitBoxGeometry || (state.edgeUnitBoxGeometry = (() => {
        const unit = new THREE.BoxGeometry(1, 1, 1);
        unit.userData = { ...(unit.userData || {}), shared: true };
        return unit;
      })());
      const material = new THREE.MeshStandardMaterial({
        color: darkColor,
        roughness: 0.35,
        metalness: 0.65,
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
        depthTest: true
      });
      if ('toneMapped' in material) material.toneMapped = false;
      material.emissive = brightColor.clone();
      material.emissiveIntensity = visuals.flowGlowBase;
      material.userData = {
        glowBase: visuals.flowGlowBase,
        glowRange: visuals.flowGlowRange,
        flowPhase: ((entry.x1 + entry.x2 + entry.z1 + entry.z2) * 0.18),
        flowDir: direction,
        flowSpeed: typeProfile.speed || 1,
        flowOffset: typeProfile.phase || 0,
        baseColor: darkColor.clone(),
        baseEmissive: brightColor.clone(),
        baseEmissiveIntensity: visuals.flowGlowBase,
        baseOpacity: 0.78
      };
      applyHeightFog(material);
      state.flowMaterials.push(material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 1;
      mesh.position.set((entry.x1 + entry.x2) / 2, edgePlane + thickness / 2, (entry.z1 + entry.z2) / 2);
      mesh.scale.set(length, thickness, thickness);
      if (Math.abs(dz) > Math.abs(dx)) {
        mesh.rotation.y = Math.PI / 2;
      }
      mesh.userData = {
        endpoints: entry.endpoints,
        edgeColor: brightColor.clone(),
        edgeBase: darkColor.clone()
      };
      group.add(mesh);
      state.edgeMeshes.push(mesh);
      if (allowFlowLights) flowLightCandidates.push({
        x: mesh.position.x,
        z: mesh.position.z,
        color: brightColor,
        weight: entry.weight,
        phase: (entry.x1 + entry.x2 + entry.z1 + entry.z2) * 0.18,
        speed: typeProfile.speed || 1,
        offset: typeProfile.phase || 0,
        dir: direction
      });
    }
  }

  if (allowFlowLights && flowLightCandidates.length) {
    flowLightCandidates.sort((a, b) => b.weight - a.weight);
    const maxLights = Math.min(12, flowLightCandidates.length);
    for (let i = 0; i < maxLights; i += 1) {
      const entry = flowLightCandidates[i];
      const light = new THREE.PointLight(entry.color, 2.2, 40, 2);
      light.position.set(entry.x, edgePlane + 0.6, entry.z);
      light.userData = {
        flowPhase: entry.phase,
        base: 1.6,
        flowSpeed: entry.speed || 1,
        flowOffset: entry.offset || 0,
        flowDir: entry.dir || 1
      };
      state.flowLights.push(light);
      state.scene.add(light);
    }
  }
  updateFlowLights();

  state.edgeTypeGroups = localEdgeTypeGroups;
  state.edgeTypes = Array.from(flowSegmentsByType.keys()).sort((a, b) => a.localeCompare(b));
};
