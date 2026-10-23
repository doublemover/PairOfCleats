import { initStackNavigation, focusStack } from './stack-navigation.js';
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
import { initViewerShell } from './workspace-shell.js';
import { loadViewerSettingsSession } from './settings-client.js';
import { applyViewerAppearance, initAppearanceEditor } from './appearance.js';
import { initResidencyOwner } from './data/residency-owner.js';
import { createRendererEnhancementOwner } from './rendering/enhancement-owner.js';
import { initSnapshotData } from './data/session-owner.js';
import { createRemoteSource } from './data/remote-source.js';
import { buildSnapshotOverview } from './rendering/snapshot-overview.js';

const initViewer = async () => {
  const loaded=loadDomConfig();
  const {map:rawMap,dom}=loaded;
  const shell=initViewerShell(state,document);
  Object.assign(state,{rawMap,map:rawMap,dom,config:loaded.config,THREE:null});
  if(loaded.config.snapshotData?.demand)state.remoteSource=createRemoteSource(loaded.config.snapshotData);
  initMapData();initStackNavigation();
  initSnapshotData(loaded.config.snapshotData);
  if(state.remoteSource){
    state.afterSceneRebuild=()=>{if(!state.residentFiles){buildSnapshotOverview(state.remoteSource.manifest);focusStack();}};
    state.showSnapshotOverview=()=>{state.resetResidency?.();rebuildScene();};
    window.addEventListener('pagehide',()=>state.remoteSource?.dispose(),{once:true});
  }
  dom.summary.textContent=`Available snapshot: ${state.sourceIndex.counts.files} files / ${state.sourceIndex.counts.members} members / ${state.sourceIndex.counts.edges} edges. Source browser ready.`;
  const settingsSession=await loadViewerSettingsSession(loaded.config,{onStatus:value=>shell.setSaveStatus(value)});
  if(!shell.adoptSettings(settingsSession))return;
  const config=settingsSession.effective(loaded.config.layout?.style||'stacks');
  state.settingsSession=settingsSession;
  shell.setSaveStatus(settingsSession.availabilityError?`save-unavailable: ${settingsSession.availabilityError}`:settingsSession.status);
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
    displayLimits: limits,
    appearance:config.appearance
  });

  const renderSummary = () => {
    const counts = state.sourceIndex?.counts || { files: 0, members: 0, edges: 0 };
    if(state.remoteSource){dom.summary.textContent=`Available snapshot: ${counts.files} files / ${counts.members} members / ${counts.edges} relationships. ${state.residentFiles?'Bounded resident detail; all available identities remain pageable.':`Whole-available directory overview · ${state.remoteSource.manifest.overview.length} aggregate proxies; select a group to browse.`}`;return;}
    const displayed=state.map?.summary?.counts||{};
    const truncated = state.map?.summary?.truncated ? ' | truncated' : '';
    dom.summary.textContent = `Available snapshot: ${counts.files} files / ${counts.members} members / ${counts.edges} edges. Display: ${displayed.files||0} / ${displayed.members||0} / ${displayed.edges||0}${truncated}`;
  };
  renderSummary();

  state.applyDisplayLimitsFromPanel = (options = {}) => {
    state.resetResidency?.();
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
  state.applyViewerSettings=fresh=>{
    state.resetResidency?.();
    Object.assign(state.layout,{...layoutDefaults,...fresh.layout});
    Object.assign(state.scoring,{...scoringDefaults,...fresh.scoring});
    Object.assign(state.colors,{...colorDefaults,...fresh.colors});
    Object.assign(state.visuals,{...visualDefaults,...fresh.visuals,glass:{...visualDefaults.glass,...fresh.visuals?.glass}});
    Object.assign(state.controls,{...controlDefaults,...fresh.controls,wasd:{...controlDefaults.wasd,...fresh.controls?.wasd}});
    Object.assign(state.performance,{...performanceDefaults,...fresh.performance,drawCaps:{...performanceDefaults.drawCaps,...fresh.performance?.drawCaps},lod:{...performanceDefaults.lod,...fresh.performance?.lod},hud:{...performanceDefaults.hud,...fresh.performance?.hud}});
    state.appearance=fresh.appearance;
    const next=applyDisplayLimits(state.rawMap,fresh.performance?.displayLimits);
    state.map=next.map;state.displayLimits=next.limits;initMapData();state.refreshStackNavigation?.();
    initUi();rebuildScene();applyViewerAppearance(state,fresh.appearance);initAppearanceEditor(state,document,dom.menuVisuals);renderSummary();
  };
  const enhancement=createRendererEnhancementOwner({state,summary:dom.summary,retry,
    loadModules:()=>{
      if(!config.threeUrl)throw new Error('Missing local three.js module reference');
      return loadThreeModules(config.threeUrl);
    },
    loadEnvironment:()=>assets.hdrEnvUrl?loadRgbeLoader(assets.rgbeLoaderUrl,config.threeUrl):null,
    construct:initScene,
    initialize:()=>{
      initMaterials();
      initUi();
      rebuildScene();
      state.setAppearance=appearance=>{applyViewerAppearance(state,appearance);state.settingsSession.update({...state.panelState,appearance:state.appearance});state.settingsSession.scheduleSave();};
      applyViewerAppearance(state,state.appearance||config.appearance);
      initAppearanceEditor(state,document,dom.menuVisuals);
      initControls();
      initResidencyOwner();
      state.scheduleRebuild=scheduleRebuild;
    },renderSummary});
  const enhance=()=>enhancement.enhance();
  window.addEventListener('pagehide',()=>enhancement.dispose(),{once:true});
  await enhance();
};

initViewer();
