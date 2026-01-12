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
    groupDepth: 1,
    groupSpacing: 24,
    fileSpacing: 12,
    baseSize: 6,
    fileHeight: 1.4,
    memberCell: 1.2,
    memberGap: 0.35,
    memberInset: 0.7,
    memberHeightBase: 0.8,
    memberHeightScale: 0.5,
    memberHeightMax: 6,
    edgeLift: 0.2
  },
  controls: {
    wasd: {
      sensitivity: 160,
      acceleration: 60,
      maxSpeed: 240,
      drag: 6
    },
    zoomSensitivity: 0.1
  }
};
