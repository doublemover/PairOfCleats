import { state } from './state.js';
import { loadDomConfig } from './dom.js';
import { loadThreeModules, loadRgbeLoader } from './three-loader.js';
import {
  assetDefaults,
  colorDefaults,
  controlDefaults,
  flowTypeProfiles,
  flowWaveLayers,
  layoutDefaults,
  performanceDefaults,
  scoringDefaults,
  visualDefaults
} from './defaults.js';
import { initScene } from './scene.js';
import { initMapData } from './map-data.js';
import { initMaterials } from './materials.js';
import { initUi } from './ui.js';
import { rebuildScene, scheduleRebuild } from './rebuild.js';
import { initControls } from './controls.js';
import { applyDisplayLimits } from './display-limits.js';

const initViewer = async () => {
  const { map: rawMap, config, dom } = loadDomConfig();
  const { map, limits } = applyDisplayLimits(rawMap, config?.performance?.displayLimits);

  if (!config.threeUrl) {
    dom.selectionBody.textContent = 'Missing three.js module reference.';
    throw new Error('threeUrl missing');
  }

  const { THREE, LineSegments2, LineSegmentsGeometry, LineMaterial } = await loadThreeModules(config.threeUrl);

  const layout = { ...layoutDefaults, ...(config.layout || {}) };
  const scoring = { ...scoringDefaults, ...(config.scoring || {}) };
  const colors = { ...colorDefaults, ...(config.colors || {}) };
  const visuals = { ...visualDefaults, ...(config.visuals || {}) };
  visuals.glass = { ...visualDefaults.glass, ...(config.visuals?.glass || {}) };
  const assets = { ...assetDefaults, ...(config.assets || {}) };
  const controls = {
    ...controlDefaults,
    ...(config.controls || {}),
    wasd: {
      ...controlDefaults.wasd,
      ...(config.controls?.wasd || {})
    }
  };

  const flowWaveTotal = flowWaveLayers.reduce((acc, layer) => acc + layer.amplitude, 0) || 1;
  const RGBELoader = await loadRgbeLoader(assets.rgbeLoaderUrl, config.threeUrl);
  const performance = {
    ...performanceDefaults,
    ...(config.performance || {}),
    drawCaps: {
      ...performanceDefaults.drawCaps,
      ...(config.performance?.drawCaps || {})
    },
    lod: {
      ...performanceDefaults.lod,
      ...(config.performance?.lod || {})
    },
    hud: {
      ...performanceDefaults.hud,
      ...(config.performance?.hud || {})
    }
  };

  Object.assign(state, {
    rawMap,
    map,
    config,
    dom,
    THREE,
    LineSegments2,
    LineSegmentsGeometry,
    LineMaterial,
    RGBELoader,
    layout,
    scoring,
    colors,
    visuals,
    assets,
    controls,
    layoutDefaults,
    scoringDefaults,
    colorDefaults,
    visualDefaults,
    performanceDefaults,
    controlDefaults,
    flowWaveLayers,
    flowWaveTotal,
    flowTypeProfiles,
    performance,
    edgeVisibility: new Map(),
    gridVisible: true,
    hoveredRef: null,
    hovered: null,
    selected: null,
    fileMeshes: [],
    fileInstancedMeshes: [],
    fileInstancedInnerMeshes: [],
    memberMeshes: [],
    chunkMeshes: [],
    // Instancing + performance structures.
    memberInstancedMeshes: [],
    memberInnerInstancedMeshes: [],
    memberClusters: [],
    memberInstanceById: new Map(),
    memberClusterByMemberId: new Map(),
    fileInstanceByKey: new Map(),
    fileBuckets: [],
    fileBucketByKey: new Map(),
    highlightedMemberIds: new Set(),
    highlightedFileKeys: new Set(),
    instancedMemberMaterials: null,
    instancedChunkMaterial: null,
    pickTargets: [],
    fileAnchors: new Map(),
    memberAnchors: new Map(),
    fileMeshByKey: new Map(),
    fileWireByKey: new Map(),
    memberMeshById: new Map(),
    fileColorByPath: new Map(),
    memberColorById: new Map(),
    wireByMesh: new Map(),
    edgeMeshes: [],
    edgeSegments: [],
    edgeDotMesh: null,
    edgeDotMaterial: null,
    edgeCullingTargets: [],
    edgeMeshPool: new Map(),
    edgeTypeGroups: new Map(),
    edgeTypes: [],
    flowLights: [],
    wireMaterials: [],
    gridLineMaterials: [],
    labelMaterials: [],
    glassMaterials: [],
    glassShells: [],
    glowMaterials: [],
    flowMaterials: [],
    normalMapState: { texture: null },
    drawCounts: { files: 0, members: 0, edges: 0, labels: 0 },
    perfStats: { fps: 0, droppedFrames: 0, frameMs: 0, heapUsed: null },
    displayLimits: limits
  });

  const renderSummary = () => {
    const counts = state.map?.summary?.counts || { files: 0, members: 0, edges: 0 };
    const truncated = state.map?.summary?.truncated ? ' | truncated' : '';
    dom.summary.textContent = `files: ${counts.files || 0} | members: ${counts.members || 0} | edges: ${counts.edges || 0}${truncated}`;
  };
  renderSummary();

  state.applyDisplayLimitsFromPanel = (options = {}) => {
    const overrides = state.panelState?.performance?.displayLimits || state.displayLimits || {};
    const next = applyDisplayLimits(state.rawMap, overrides);
    state.map = next.map;
    state.displayLimits = next.limits;
    initMapData();
    renderSummary();
    if (options.rebuild !== false) {
      scheduleRebuild(options.delayMs ?? 80);
    }
  };

  await initScene();
  initMapData();
  initMaterials();
  initUi();
  rebuildScene();
  initControls();
  state.scheduleRebuild = scheduleRebuild;
};

initViewer();
