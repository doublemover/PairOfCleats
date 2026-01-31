import { state } from './state.js';
import { applyHeightFog, updateFlowLights } from './materials.js';
import { aggregateEdges, createFlowSegmentAggregator } from './edges/aggregate.js';
import { buildEndpointDotsMesh, createEndpointDotTracker } from './edges/endpoints.js';
import { createEdgeResolvers } from './edges/resolvers.js';
import { createRoutingHelpers } from './edges/routing.js';
import { createEdgeStyleHelpers, createFlowMaterial, resolveSegmentStyle } from './edges/style.js';

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
    visuals,
    layoutStyle
  } = state;

  const edgePlane = layoutMetrics.edgePlane;
  const routingPadding = layoutMetrics.routingPadding;
  const routingStep = layoutMetrics.routingStep;

  const edgeCount = edges.length;
  const fastMode = edgeCount > 5000;
  const ultraMode = edgeCount > 15000;
  const quantizeStep = ultraMode ? 0.5 : (fastMode ? 0.25 : 0.001);
  const allowFlowLights = visuals.enableFlowLights !== false && !fastMode;
  const allowEdgeSegments = !fastMode;
  const allowEndpointDots = !fastMode;
  const useMemberAnchors = !fastMode;
  const useRouting = !fastMode;
  const curveEdges = !fastMode && visuals.curveEdges === true;

  const { normalizeMemberId, resolveEdgeFile, resolveEdgeColor, resolveAnchor } = createEdgeResolvers({
    fileByMember,
    memberColorById,
    fileColorByPath,
    memberAnchors,
    fileAnchors,
    useMemberAnchors
  });

  const obstacles = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  if (useRouting) {
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
  }

  const { findRoute } = createRoutingHelpers({
    useRouting,
    layoutStyle,
    routingStep,
    layoutMetrics,
    routingPadding,
    obstacles,
    bounds: { minX, maxX, minZ, maxZ }
  });
  const flowLightCandidates = allowFlowLights ? [] : null;
  const { resolveEdgeType, resolveEdgeStyle } = createEdgeStyleHelpers({ state });
  const { flowSegmentsByType, addFlowSegment } = createFlowSegmentAggregator({
    quantizeStep,
    normalizeMemberId,
    fileByMember
  });

  const edgeHighlight = new THREE.Color('#ffffff');
  const { endpointDots, addEndpointDot } = createEndpointDotTracker({ THREE });
  const planeY = edgePlane + Math.max(0.08, (layoutMetrics.memberGap || 0) * 0.3);
  const trackEndpoints = !fastMode;
  const addPathPoints = (points, startAnchor, endAnchor, routePoints) => {
    const startPlane = { x: startAnchor.x, y: planeY, z: startAnchor.z };
    const endPlane = { x: endAnchor.x, y: planeY, z: endAnchor.z };
    if (curveEdges) {
      const startLift = Math.max(0.4, Math.abs(startAnchor.y - planeY) * 0.5);
      const endLift = Math.max(0.4, Math.abs(endAnchor.y - planeY) * 0.5);
      points.push(startAnchor);
      points.push({ x: startAnchor.x, y: Math.max(startAnchor.y, planeY) + startLift, z: startAnchor.z });
      points.push(startPlane);
    } else {
      points.push(startAnchor);
      points.push(startPlane);
    }
    routePoints.forEach((point, index) => {
      if (index === 0 || index === routePoints.length - 1) return;
      points.push({ x: point.x, y: planeY, z: point.z });
    });
    if (curveEdges) {
      const endLift = Math.max(0.4, Math.abs(endAnchor.y - planeY) * 0.5);
      points.push(endPlane);
      points.push({ x: endAnchor.x, y: Math.max(endAnchor.y, planeY) + endLift, z: endAnchor.z });
      points.push(endAnchor);
    } else {
      points.push(endPlane);
      points.push(endAnchor);
    }
  };

  const edgeEntries = fastMode
    ? aggregateEdges({
      edges,
      edgeWeights,
      fileColorByPath,
      resolveEdgeType,
      resolveEdgeFile,
      THREE
    })
    : edges.map((edge) => ({ edge }));

  for (const entry of edgeEntries) {
    const edge = entry.edge || entry;
    const rawType = entry.type || edge?.type || 'other';
    const type = entry.type || resolveEdgeType(rawType);
    const weight = entry.weight ?? (edgeWeights[type] || edgeWeights[rawType] || 1);
    const fromFile = entry.fromFile ?? resolveEdgeFile(edge?.from);
    const toFile = entry.toFile ?? resolveEdgeFile(edge?.to);
    const startAnchor = entry.startAnchor ?? resolveAnchor(edge?.from, fromFile);
    const endAnchor = entry.endAnchor ?? resolveAnchor(edge?.to, toFile);
    if (!startAnchor || !endAnchor) continue;
    const ignoreFiles = new Set([fromFile, toFile].filter(Boolean));
    const start = { x: startAnchor.x, z: startAnchor.z };
    const end = { x: endAnchor.x, z: endAnchor.z };
    const routePoints = useRouting ? findRoute(start, end, ignoreFiles) : [start, end];
    const style = resolveEdgeStyle(type);
    const fromColor = entry.edgeColor ? null : resolveEdgeColor(edge?.from);
    const toColor = entry.edgeColor ? null : resolveEdgeColor(edge?.to);
    let edgeColor = entry.edgeColor || null;
    if (!edgeColor) {
      if (fromColor && toColor) {
        edgeColor = fromColor.clone().lerp(toColor, 0.5);
      } else {
        edgeColor = fromColor || toColor || new THREE.Color(style.color || '#9aa0a6');
      }
    }
    const pathPoints = [];
    addPathPoints(pathPoints, startAnchor, endAnchor, routePoints);
    const path = curveEdges
      ? new THREE.CatmullRomCurve3(pathPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z)), false, 'centripetal', 0.4)
      : null;
    const resolvedPoints = path
      ? path.getPoints(Math.min(40, Math.max(12, pathPoints.length * 3)))
      : pathPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    for (let i = 0; i < resolvedPoints.length - 1; i += 1) {
      const a = resolvedPoints[i];
      const b = resolvedPoints[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const dominant = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
      const dir = dominant === Math.abs(dx)
        ? Math.sign(dx)
        : (dominant === Math.abs(dy) ? Math.sign(dy) : Math.sign(dz));
      addFlowSegment(type, a.x, a.y, a.z, b.x, b.y, b.z, weight, edgeColor, dir, trackEndpoints ? edge : null);
    }
    if (allowEndpointDots && edgeColor) {
      const fromMemberKey = normalizeMemberId(edge?.from?.member);
      const toMemberKey = normalizeMemberId(edge?.to?.member);
      if (fromMemberKey) addEndpointDot(`member:${fromMemberKey}`, startAnchor, edgeColor);
      if (edge?.from?.file) addEndpointDot(`file:${edge.from.file}`, startAnchor, edgeColor);
      if (toMemberKey) addEndpointDot(`member:${toMemberKey}`, endAnchor, edgeColor);
      if (edge?.to?.file) addEndpointDot(`file:${edge.to.file}`, endAnchor, edgeColor);
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
    const entries = Array.from(segments.values());
    if (!entries.length) continue;
    const geometry = state.edgeUnitBoxGeometry || (state.edgeUnitBoxGeometry = (() => {
      const unit = new THREE.BoxGeometry(1, 1, 1);
      unit.userData = { ...(unit.userData || {}), shared: true };
      return unit;
    })());
    const material = createFlowMaterial({ THREE, visuals, applyHeightFog, type, typeProfile, style });
    state.flowMaterials.push(material);

    const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
    mesh.renderOrder = 7;
    const dummy = new THREE.Object3D();
    const axis = new THREE.Vector3(1, 0, 0);
    const direction = new THREE.Vector3();
    const baseColors = new Array(entries.length);
    const highlightColors = new Array(entries.length);
    entries.forEach((entry, index) => {
      const dx = entry.x2 - entry.x1;
      const dy = entry.y2 - entry.y1;
      const dz = entry.z2 - entry.z1;
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (!length) return;
      const { thickness, brightColor, highlightColor, flowDirection } = resolveSegmentStyle({
        THREE,
        entry,
        style,
        fallbackColor,
        edgeHighlight
      });
      dummy.position.set((entry.x1 + entry.x2) / 2, (entry.y1 + entry.y2) / 2, (entry.z1 + entry.z2) / 2);
      direction.set(dx, dy, dz).normalize();
      dummy.quaternion.setFromUnitVectors(axis, direction);
      dummy.scale.set(length, thickness, thickness);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      mesh.setColorAt(index, brightColor);
      baseColors[index] = brightColor;
      highlightColors[index] = highlightColor;
      if (allowEdgeSegments) {
        state.edgeSegments.push({
          mesh,
          index,
          endpoints: entry.endpoints,
          edgeColor: brightColor,
          highlightColor
        });
      }
      if (allowFlowLights && flowLightCandidates) {
        flowLightCandidates.push({
          x: dummy.position.x,
          y: dummy.position.y,
          z: dummy.position.z,
          color: brightColor,
          weight: entry.weight,
          phase: (entry.x1 + entry.x2 + entry.z1 + entry.z2) * 0.18,
          speed: typeProfile.speed || 1,
          offset: typeProfile.phase || 0,
          dir: flowDirection
        });
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.userData = {
      instanceBaseColors: baseColors,
      instanceHighlightColors: highlightColors
    };
    group.add(mesh);
    state.edgeMeshes.push(mesh);
  }

  if (allowFlowLights && flowLightCandidates && flowLightCandidates.length) {
    flowLightCandidates.sort((a, b) => b.weight - a.weight);
    const maxLights = Math.min(32, flowLightCandidates.length);
    for (let i = 0; i < maxLights; i += 1) {
      const entry = flowLightCandidates[i];
      const light = new THREE.PointLight(entry.color, 2.2, 40, 2);
      light.position.set(entry.x, (entry.y ?? edgePlane) + 0.6, entry.z);
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

  buildEndpointDotsMesh({ THREE, endpointDots, edgeGroup, visuals, state, applyHeightFog });
  updateFlowLights();

  state.edgeTypeGroups = localEdgeTypeGroups;
  state.edgeTypes = Array.from(flowSegmentsByType.keys()).sort((a, b) => a.localeCompare(b));
};

