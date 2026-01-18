export const MAP_MODEL_VERSION = '1.0.0';

export const DEFAULT_LIMITS = {
  maxFiles: 200,
  maxMembersPerFile: 60,
  maxEdges: 3000
};

export const DEFAULT_LEGEND = {
  nodeTypes: ['file', 'function', 'class', 'symbol'],
  fileShapes: {
    source: 'component',
    test: 'box',
    config: 'cylinder',
    docs: 'note',
    generated: 'folder',
    dir: 'folder',
    other: 'box'
  },
  functionBadges: {
    async: 'A',
    static: 'S',
    generator: 'G',
    visibility: 'V',
    returns: 'R',
    reads: 'Rd',
    writes: 'Wr',
    mutates: 'Mu',
    aliases: 'Al',
    branches: 'Br',
    loops: 'Lp',
    throws: 'Th',
    awaits: 'Aw',
    yields: 'Yd'
  },
  edgeTypes: {
    imports: 'import',
    calls: 'call',
    usages: 'usage',
    dataflow: 'dataflow',
    exports: 'export',
    aliases: 'alias'
  },
  edgeStyles: {
    import: { style: 'dashed', color: '#4b7bec' },
    call: { style: 'solid', color: '#2d3436' },
    usage: { style: 'dotted', color: '#636e72' },
    dataflow: { style: 'dotted', color: '#00b894' },
    export: { style: 'bold', color: '#f0932b' },
    alias: { style: 'dashdot', color: '#6c5ce7' }
  }
};

export const FILE_CATEGORY_RULES = {
  test: {
    extensions: ['.spec', '.test'],
    names: ['__tests__', 'tests', 'test'],
    patterns: [/\/__tests__\//, /\/tests\//, /\.spec\./, /\.test\./]
  },
  docs: {
    extensions: ['.md', '.rst', '.txt', '.adoc', '.asciidoc']
  },
  config: {
    extensions: ['.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env', '.properties', '.xml']
  },
  generated: {
    names: ['dist', 'build', 'out', 'coverage', 'vendor', 'node_modules', '.pairofcleats'],
    patterns: [/\/dist\//, /\/build\//, /\/out\//, /\/coverage\//, /\/vendor\//, /\/node_modules\//]
  }
};

export const FILE_CATEGORY_COLORS = {
  source: '#2980b9',
  test: '#8e44ad',
  config: '#16a085',
  docs: '#d35400',
  generated: '#7f8c8d',
  dir: '#34495e',
  other: '#2c3e50'
};

export const VIEWER_DEFAULTS = {
  layout: {
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
  },
  visuals: {
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
    enableFlowLights: true,
    enableFog: false,
    enableHeightFog: false,
    fogDistance: 2.8,
    fogColor: '#0f1115',
    fogHeight: 4,
    fogHeightRange: 14,
    enableExtraLights: true,
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
  },
  controls: {
    wasd: {
      sensitivity: 40000,
      acceleration: 16000,
      maxSpeed: 120000,
      drag: 6
    },
    zoomSensitivity: 6,
    zoomMin: 1,
    zoomMax: 80,
    zoomDamping: 0.9,
    panSensitivity: 1.5
  }
};
