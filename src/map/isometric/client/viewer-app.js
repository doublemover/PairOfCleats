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
  scoringDefaults,
  visualDefaults
} from './defaults.js';
import { initScene } from './scene.js';
import { initMapData } from './map-data.js';
import { initMaterials } from './materials.js';
import { initUi } from './ui.js';
import { rebuildScene, scheduleRebuild } from './rebuild.js';
import { initControls } from './controls.js';

const initViewer = async () => {
  const { map, config, dom } = loadDomConfig();

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

  const flowWaveTotal =
    flowWaveLayers.reduce((acc, layer) => acc + layer.amplitude, 0) || 1;
  const RGBELoader = await loadRgbeLoader(assets.rgbeLoaderUrl);

  Object.assign(state, {
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
    controlDefaults,
    flowWaveLayers,
    flowWaveTotal,
    flowTypeProfiles,
    edgeVisibility: new Map(),
    gridVisible: true,
    hoveredRef: null,
    hoveredMesh: null,
    selected: null,
    fileMeshes: [],
    memberMeshes: [],
    chunkMeshes: [],
    fileChunkMeshes: [],
    fileAnchors: new Map(),
    memberAnchors: new Map(),
    fileMeshByKey: new Map(),
    memberMeshById: new Map(),
    fileColorByPath: new Map(),
    memberColorById: new Map(),
    wireByMesh: new Map(),
    edgeMeshes: [],
    edgeSegments: [],
    edgeDotMesh: null,
    edgeDotMaterial: null,
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
    normalMapState: { texture: null }
  });

  const counts = map.summary?.counts || { files: 0, members: 0, edges: 0 };
  dom.summary.textContent =
    `files: ${counts.files || 0} | members: ${counts.members || 0}` +
    ` | edges: ${counts.edges || 0}`;

  await initScene();
  initMapData();
  initMaterials();
  initUi();
  rebuildScene();
  initControls();
  state.scheduleRebuild = scheduleRebuild;
};

initViewer();
