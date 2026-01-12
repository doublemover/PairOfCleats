import { state } from './state.js';
import { clearGroup, disposeObject } from './scene-utils.js';
import { applyHeightFog, updateFog, updateGridGlow, updateFlowLights } from './materials.js';
import { computeLayout } from './layout.js';
import { buildMeshes } from './meshes.js';
import { buildEdges } from './edges.js';
import { applyHighlights } from './selection.js';

const resetScene = () => {
  clearGroup(state.fileGroup);
  clearGroup(state.memberGroup);
  clearGroup(state.labelGroup);
  clearGroup(state.edgeGroup);
  clearGroup(state.wireGroup);
  state.fileMeshes = [];
  state.memberMeshes = [];
  state.chunkMeshes = [];
  state.fileChunkMeshes = [];
  state.glowMaterials = [];
  state.flowMaterials = [];
  state.glassMaterials = [];
  state.labelMaterials = [];
  state.glassShells = [];
  state.wireMaterials = [];
  state.gridLineMaterials = [];
  state.edgeMeshes = [];
  state.edgeSegments = [];
  state.edgeDotMesh = null;
  state.edgeDotMaterial = null;
  state.fileMeshByKey = new Map();
  state.memberMeshById = new Map();
  state.wireByMesh = new Map();
  state.fileAnchors = new Map();
  state.memberAnchors = new Map();
  state.fileColorByPath = new Map();
  state.memberColorById = new Map();
  state.edgeTypeGroups = new Map();
  state.edgeTypes = [];
  if (state.flowLights) {
    state.flowLights.forEach((light) => state.scene.remove(light));
  }
  state.flowLights = [];
  if (state.grid) {
    state.scene.remove(state.grid);
    disposeObject(state.grid);
    state.grid = null;
  }
  if (state.gridLines) {
    clearGroup(state.gridLines);
    state.scene.remove(state.gridLines);
    state.gridLines = null;
  }
};

export const scheduleRebuild = (delay = 180) => {
  if (state.rebuildTimer) {
    clearTimeout(state.rebuildTimer);
  }
  state.rebuildTimer = setTimeout(() => {
    state.rebuildTimer = null;
    rebuildScene();
  }, delay);
};

export const rebuildScene = () => {
  if (typeof state.syncStateFromPanel === 'function') {
    state.syncStateFromPanel();
  }
  const preservedCamera = {
    position: state.camera.position.clone(),
    zoom: state.camera.zoom
  };
  resetScene();
  computeLayout();

  const {
    THREE,
    visuals,
    LineMaterial,
    LineSegments2,
    LineSegmentsGeometry,
    layoutMetrics,
    bounds,
    scene,
    lineResolution,
    lockIsometric,
    camera,
    controlDefaults,
    controls,
    renderer
  } = state;

  const edgePlane = layoutMetrics.edgePlane;
  const gridSize = Math.max(80, Math.ceil(bounds.maxSpan * 1.4 / 10) * 10);
  const groundGeometry = new THREE.PlaneGeometry(gridSize, gridSize);
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: 0x151a20,
    metalness: 1,
    roughness: 0.25,
    envMapIntensity: visuals.glass.envMapIntensity * 0.6
  });
  applyHeightFog(groundMaterial);
  state.grid = new THREE.Mesh(groundGeometry, groundMaterial);
  state.grid.rotation.x = -Math.PI / 2;
  state.grid.position.y = edgePlane - 0.05 * state.scaleFactor;
  state.grid.receiveShadow = true;
  scene.add(state.grid);
  state.grid.visible = state.gridVisible;
  state.groundPlane.constant = -state.grid.position.y;

  const gridLineStep = Math.max(2, Math.round(layoutMetrics.baseSize));
  const gridHalf = gridSize / 2;
  const gridY = state.grid.position.y + 0.02 * state.scaleFactor;
  const gridBuckets = [
    { positions: [], phase: 0 },
    { positions: [], phase: 1.8 },
    { positions: [], phase: 3.6 }
  ];
  let lineIndex = 0;
  for (let x = -gridHalf; x <= gridHalf; x += gridLineStep) {
    const bucket = gridBuckets[lineIndex % gridBuckets.length];
    bucket.positions.push(x, gridY, -gridHalf, x, gridY, gridHalf);
    lineIndex += 1;
  }
  for (let z = -gridHalf; z <= gridHalf; z += gridLineStep) {
    const bucket = gridBuckets[lineIndex % gridBuckets.length];
    bucket.positions.push(-gridHalf, gridY, z, gridHalf, gridY, z);
    lineIndex += 1;
  }
  const gridLineColor = new THREE.Color('#3b4350');
  state.gridLines = new THREE.Group();
  gridBuckets.forEach((bucket) => {
    if (!bucket.positions.length) return;
    let gridLineMaterial;
    if (LineMaterial && LineSegments2 && LineSegmentsGeometry) {
      gridLineMaterial = new LineMaterial({
        color: gridLineColor,
        transparent: true,
        opacity: visuals.gridGlowBase,
        linewidth: visuals.gridLineThickness,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false
      });
      gridLineMaterial.resolution.set(lineResolution.width, lineResolution.height);
    } else {
      gridLineMaterial = new THREE.LineBasicMaterial({
        color: gridLineColor,
        transparent: true,
        opacity: visuals.gridGlowBase,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false
      });
    }
    gridLineMaterial.userData = {
      glowBase: visuals.gridGlowBase,
      glowRange: visuals.gridGlowRange,
      flowSpeed: visuals.gridPulseSpeed,
      flowPhase: bucket.phase
    };
    if ('toneMapped' in gridLineMaterial) gridLineMaterial.toneMapped = false;
    applyHeightFog(gridLineMaterial);
    state.gridLineMaterials.push(gridLineMaterial);
    if (LineSegments2 && LineSegmentsGeometry && gridLineMaterial instanceof LineMaterial) {
      const gridGeom = new LineSegmentsGeometry();
      gridGeom.setPositions(bucket.positions);
      const lineMesh = new LineSegments2(gridGeom, gridLineMaterial);
      lineMesh.computeLineDistances();
      state.gridLines.add(lineMesh);
    } else {
      const gridGeom = new THREE.BufferGeometry();
      gridGeom.setAttribute('position', new THREE.Float32BufferAttribute(bucket.positions, 3));
      state.gridLines.add(new THREE.LineSegments(gridGeom, gridLineMaterial));
    }
  });
  state.gridLines.renderOrder = 1;
  state.gridLines.visible = state.gridVisible;
  scene.add(state.gridLines);
  updateGridGlow();
  updateFog(bounds.maxSpan);

  const targetCameraBase = Math.max(40, bounds.maxSpan * 0.6);
  const cameraDistance = Math.max(60, bounds.maxSpan * 1.2);
  if (!state.cameraInitialized) {
    state.cameraBase = targetCameraBase;
  }
  state.farPlane = Math.max(5000, bounds.maxSpan * 10);
  state.nearPlane = Math.max(0.1, state.farPlane / 100000);
  const viewport = typeof state.getViewport === 'function'
    ? state.getViewport()
    : { width: 1, height: 1 };
  const aspect = viewport.height ? viewport.width / viewport.height : 1;
  camera.left = -state.cameraBase * aspect;
  camera.right = state.cameraBase * aspect;
  camera.top = state.cameraBase;
  camera.bottom = -state.cameraBase;
  camera.near = state.nearPlane;
  camera.far = state.farPlane;
  const zoomMin = Number.isFinite(controls.zoomMin) ? controls.zoomMin : controlDefaults.zoomMin;
  const zoomMax = Number.isFinite(controls.zoomMax) ? controls.zoomMax : controlDefaults.zoomMax;
  if (!state.cameraInitialized) {
    camera.position.set(cameraDistance, cameraDistance * 0.9, cameraDistance);
    lockIsometric();
    state.cameraInitialized = true;
  } else {
    camera.position.copy(preservedCamera.position);
    lockIsometric();
  }
  camera.zoom = Math.max(zoomMin, Math.min(zoomMax, preservedCamera.zoom || camera.zoom));
  camera.updateProjectionMatrix();
  lockIsometric();

  buildMeshes();
  buildEdges();
  updateFlowLights();
  if (typeof state.renderEdgeMenu === 'function') {
    state.renderEdgeMenu();
  }
  applyHighlights();
  if (renderer?.shadowMap) {
    renderer.shadowMap.needsUpdate = true;
  }
};
