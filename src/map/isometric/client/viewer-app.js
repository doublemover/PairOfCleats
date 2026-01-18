import { state } from './state.js';
import { loadDomConfig } from './dom.js';
import { loadThreeModules, loadRgbeLoader } from './three-loader.js';
import {
  assetDefaults,
  colorDefaults,
  controlDefaults,
  displayDefaults,
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

const resolveLimit = (value, fallback) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Number(value));
};

const normalizeDisplayLimits = (overrides = {}) => {
  const maxFiles = resolveLimit(overrides.maxFiles, displayDefaults.maxFiles);
  const maxMembers = resolveLimit(overrides.maxMembersPerFile, displayDefaults.maxMembersPerFile);
  const maxEdges = resolveLimit(overrides.maxEdges, displayDefaults.maxEdges);
  return { maxFiles, maxMembersPerFile: maxMembers, maxEdges };
};

const applyDisplayLimits = (map, overrides) => {
  if (!map || typeof map !== 'object') return { map: map || {}, limits: normalizeDisplayLimits() };
  const limits = normalizeDisplayLimits(overrides);
  const { maxFiles, maxMembersPerFile: maxMembers, maxEdges } = limits;

  const nodes = Array.isArray(map.nodes) ? map.nodes : [];
  const edges = Array.isArray(map.edges) ? map.edges : [];
  const limitedNodes = [];
  let droppedMembers = 0;

  for (const node of nodes.slice(0, maxFiles)) {
    const members = Array.isArray(node.members) ? node.members : [];
    const keptMembers = members.slice(0, maxMembers);
    droppedMembers += Math.max(0, members.length - keptMembers.length);
    limitedNodes.push({ ...node, members: keptMembers });
  }

  const droppedFiles = Math.max(0, nodes.length - limitedNodes.length);
  const fileSet = new Set();
  const memberSet = new Set();

  for (const node of limitedNodes) {
    const fileKey = node.path || node.name || null;
    if (fileKey) fileSet.add(fileKey);
    for (const member of node.members || []) {
      if (member?.id === 0 || member?.id) memberSet.add(String(member.id));
    }
  }

  const filteredEdges = edges.filter((edge) => {
    const fromMember = edge?.from?.member;
    const toMember = edge?.to?.member;
    const fromFile = edge?.from?.file;
    const toFile = edge?.to?.file;
    if (fromMember && !memberSet.has(String(fromMember))) return false;
    if (toMember && !memberSet.has(String(toMember))) return false;
    if (fromFile && !fileSet.has(fromFile)) return false;
    if (toFile && !fileSet.has(toFile)) return false;
    return true;
  });

  const limitedEdges = filteredEdges.length > maxEdges
    ? filteredEdges.slice(0, maxEdges)
    : filteredEdges;
  const droppedEdges = Math.max(0, filteredEdges.length - limitedEdges.length);

  const counts = {
    files: limitedNodes.length,
    members: limitedNodes.reduce((acc, node) => acc + (node.members?.length || 0), 0),
    edges: limitedEdges.length
  };
  const dropped = { files: droppedFiles, members: droppedMembers, edges: droppedEdges };
  const truncated = droppedFiles > 0 || droppedMembers > 0 || droppedEdges > 0;

  const nextMap = {
    ...map,
    nodes: limitedNodes,
    edges: limitedEdges,
    summary: {
      ...(map.summary || {}),
      counts,
      dropped,
      truncated,
      limits
    },
    viewer: {
      ...(map.viewer || {}),
      performance: {
        ...(map.viewer?.performance || {}),
        displayLimits: limits
      }
    }
  };

  return { map: nextMap, limits };
};

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
    controlDefaults,
    flowWaveLayers,
    flowWaveTotal,
    flowTypeProfiles,
    edgeVisibility: new Map(),
    gridVisible: true,
    hoveredRef: null,
    hovered: null,
    selected: null,
    fileMeshes: [],
    memberMeshes: [],
    chunkMeshes: [],
    // Instancing + performance structures.
    memberInstancedMeshes: [],
    memberInnerInstancedMeshes: [],
    memberClusters: [],
    memberInstanceById: new Map(),
    highlightedMemberIds: new Set(),
    instancedMemberMaterials: null,
    instancedChunkMaterial: null,
    pickTargets: [],
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
    normalMapState: { texture: null },
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
