import { initStackNavigation } from './stack-navigation.js';
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

  dom.summary.textContent = 'Preparing bounded source model…';
  const layout = { ...layoutDefaults, ...(config.layout || {}) };
  const scoring = { ...scoringDefaults, ...(config.scoring || {}) };
  const colors = { ...colorDefaults, ...(config.colors || {}) };
  const visuals = { ...visualDefaults, ...(config.visuals || {}) };
  visuals.glass = { ...visualDefaults.glass, ...(config.visuals?.glass || {}) };
  const assets = { ...assetDefaults, ...(layout.style === 'stacks' ? { hdrEnvUrl: null, normalMapUrl: null } : {}), ...(config.assets || {}) };
  const controls = {
    ...controlDefaults,
    ...(config.controls || {}),
    wasd: {
      ...controlDefaults.wasd,
      ...(config.controls?.wasd || {})
    }
  };

  const flowWaveTotal = flowWaveLayers.reduce((acc, layer) => acc + layer.amplitude, 0) || 1;
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
    perfStats: { fps: null, slowCallbacks: 0, callbackIntervalMs: null, heapUsed: null },
    displayLimits: limits
  });

  const renderSummary = () => {
    const counts = state.sourceIndex?.counts || { files: 0, members: 0, edges: 0 };
    const displayed=state.map?.summary?.counts||{};
    const truncated = state.map?.summary?.truncated ? ' | truncated' : '';
    dom.summary.textContent = `Available snapshot: ${counts.files} files / ${counts.members} members / ${counts.edges} edges. Display: ${displayed.files||0} / ${displayed.members||0} / ${displayed.edges||0}${truncated}`;
  };
  renderSummary();

  state.applyDisplayLimitsFromPanel = (options = {}) => {
    const overrides = state.panelState?.performance?.displayLimits || state.displayLimits || {};
    const next = applyDisplayLimits(state.rawMap, overrides);
    state.map = next.map;
    state.displayLimits = next.limits;
    initMapData();
    state.refreshStackNavigation?.();
    renderSummary();
    if (options.rebuild !== false) {
      scheduleRebuild(options.delayMs ?? 80);
    }
  };

  initMapData();
  initStackNavigation();
  const retry=document.createElement('button');retry.type='button';retry.textContent='Retry 3D assets';
  retry.onclick=()=>enhance();
  state.onRendererStatus=message=>{dom.summary.textContent=message;dom.summary.append(retry);};
  state.rebuildAfterContextRestore=()=>{rebuildScene();initControls();renderSummary();};
  const enhance=async()=>{
    retry.remove();
    dom.summary.textContent='Source browser ready · loading local 3D assets…';
    try {
      if(!config.threeUrl)throw new Error('Missing local three.js module reference');
      Object.assign(state,await loadThreeModules(config.threeUrl));
      state.RGBELoader=assets.hdrEnvUrl?await loadRgbeLoader(assets.rgbeLoaderUrl,config.threeUrl):null;
      dom.summary.textContent='Source browser ready · constructing 3D scene…';
      await initScene();
      initMaterials();
      initUi();
      rebuildScene();
      initControls();
      state.scheduleRebuild=scheduleRebuild;
      renderSummary();
    } catch(error) {
      state.disposeScene?.();
      dom.summary.textContent=`3D unavailable: ${error.message}. Source hierarchy and inspection remain usable.`;
      dom.summary.append(retry);
    }
  };
  await enhance();
};

initViewer();
