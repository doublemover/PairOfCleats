export const ISOMETRIC_LAYOUT_DEFAULTS = {
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

export const ISOMETRIC_VISUAL_DEFAULTS = {
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
  enableFog: false,
  enableHeightFog: false,
  fogDistance: 2.8,
  fogColor: '#0f1115',
  fogHeight: 4,
  fogHeightRange: 14,
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

export const ISOMETRIC_CONTROL_DEFAULTS = {
  panSensitivity: 1.5,
  zoomDamping: 0.9,
  zoomMax: 80,
  wasd: {
    sensitivity: 40000,
    acceleration: 16000,
    maxSpeed: 120000,
    drag: 6
  }
};

export const ISOMETRIC_EDGE_WEIGHTS = {
  import: 3,
  export: 3,
  call: 2.5,
  usage: 2,
  dataflow: 2,
  alias: 1.5
};
