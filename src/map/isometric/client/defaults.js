import {
  ISOMETRIC_CONTROL_DEFAULTS,
  ISOMETRIC_EDGE_WEIGHTS,
  ISOMETRIC_LAYOUT_DEFAULTS,
  ISOMETRIC_VISUAL_DEFAULTS
} from './default-values.js';

export const layoutDefaults = { ...ISOMETRIC_LAYOUT_DEFAULTS };

export const scoringDefaults = {
  dataflow: 0.85,
  controlFlow: 0.8,
  params: 0.35,
  signature: 0.02,
  exported: 1.0,
  modifiers: 0.3,
  type: 1.0,
  returns: 0.7
};

export const colorDefaults = {
  mode: 'score',
  hueStart: 0.72,
  hueEnd: 0.08,
  saturation: 0.75,
  lightnessMin: 0.42,
  lightnessMax: 0.72,
  distinctSaturation: 0.66,
  distinctLightness: 0.58,
  distinctHueOffset: 0.08
};

export const assetDefaults = {
  normalMapUrl: '/assets/isomap/normal.jpg',
  hdrEnvUrl: '/assets/isomap/moonless_golf_2k.hdr',
  rgbeLoaderUrl: '/three/examples/jsm/loaders/RGBELoader.js'
};

export const visualDefaults = {
  ...ISOMETRIC_VISUAL_DEFAULTS,
  pixelRatioCap: 1.25,
  enableShadows: false,
  enableFlowLights: false,
  enableExtraLights: false,
  glass: { ...ISOMETRIC_VISUAL_DEFAULTS.glass }
};

export const controlDefaults = {
  ...ISOMETRIC_CONTROL_DEFAULTS,
  zoomSensitivity: 18,
  zoomMin: 0.05,
  wasd: { ...ISOMETRIC_CONTROL_DEFAULTS.wasd }
};

export const displayDefaults = {
  maxFiles: 60,
  maxMembersPerFile: 20,
  maxEdges: 400
};

export const performanceDefaults = {
  drawCaps: {
    files: 500,
    members: 12000,
    edges: 16000,
    labels: 2000
  },
  bucketSize: 40,
  cullInterval: 0.08,
  frameBudgetMs: 18,
  lod: {
    zoomHigh: 20,
    zoomLow: 6,
    edgeCountHigh: 12000,
    edgeCountLow: 3000
  },
  hud: {
    enabled: false
  }
};

export const flowWaveLayers = [
  { speed: 0.9, amplitude: 0.6 },
  { speed: 1.6, amplitude: 0.35 },
  { speed: 2.4, amplitude: 0.25 },
  { speed: 3.4, amplitude: 0.18 }
];

export const flowTypeProfiles = {
  dataflow: { speed: 1.2, phase: 0.0 },
  export: { speed: 1.5, phase: 1.4 },
  call: { speed: 1.8, phase: 2.1 },
  import: { speed: 1.0, phase: 2.8 },
  usage: { speed: 0.9, phase: 3.6 },
  alias: { speed: 1.3, phase: 4.3 },
  other: { speed: 1.0, phase: 0.8 }
};

export const defaultEdgeWeights = { ...ISOMETRIC_EDGE_WEIGHTS };
