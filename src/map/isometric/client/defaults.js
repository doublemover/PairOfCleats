export const layoutDefaults = {
  style: 'flow',
  groupDepth: 1,
  groupSpacing: 3.2,
  fileSpacing: 2,
  compactness: 1,
  baseSize: 3.2,
  fileHeight: 1.2,
  fileShape: 'category',
  memberShape: 'category',
  memberCell: 0.9,
  memberGap: 0.2,
  memberInset: 0.35,
  memberHeightBase: 0.8,
  memberHeightScale: 0.55,
  memberHeightMax: 7,
  edgePlane: -1,
  routingPadding: 0.9,
  routingStep: 1.3,
  labelScale: 0.018,
  labelOffset: 0.08
};

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
  fileOpacity: 1,
  memberOpacity: 1,
  flowGlowBase: 0.9,
  flowGlowRange: 0.75,
  glowPulseSpeed: 1.4,
  wireframeThickness: 0.08,
  wireframeGlow: 0.18,
  wirePulseSpeed: 0.18,
  gridLineThickness: 0.5,
  gridGlowBase: 0.2,
  gridGlowRange: 0.38,
  gridPulseSpeed: 0.2,
  pixelRatioCap: 1.25,
  enableShadows: false,
  enableFlowLights: false,
  enableFog: false,
  enableHeightFog: false,
  fogDistance: 2.8,
  fogColor: '#0f1115',
  fogHeight: 4,
  fogHeightRange: 14,
  enableExtraLights: false,
  glass: {
    metalness: 0.15,
    roughness: 0.03,
    transmission: 1,
    ior: 1.6,
    reflectivity: 1,
    thickness: 3.6,
    envMapIntensity: 5.2,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    normalScale: 0.22,
    clearcoatNormalScale: 0.16,
    normalRepeat: 2.8
  }
};

export const controlDefaults = {
  panSensitivity: 1.5,
  zoomSensitivity: 18,
  zoomDamping: 0.9,
  zoomMin: 0.05,
  zoomMax: 80,
  wasd: {
    sensitivity: 40000,
    acceleration: 16000,
    maxSpeed: 120000,
    drag: 6
  }
};

export const displayDefaults = {
  maxFiles: 60,
  maxMembersPerFile: 20,
  maxEdges: 400
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
