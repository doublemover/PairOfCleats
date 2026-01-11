const createBuildProgressState = () => ({
  step: null,
  total: 0,
  startMs: 0,
  lastLoggedMs: 0,
  lastCount: 0,
  lastPct: 0,
  label: '',
  mode: null,
  lineTotals: { code: 0, prose: 0 },
  linesProcessed: { code: 0, prose: 0 },
  linesByFile: { code: new Map(), prose: new Map() },
  filesSeen: { code: new Set(), prose: new Set() },
  currentFile: null,
  currentLine: 0,
  currentLineTotal: 0,
  currentShard: null,
  currentShardIndex: null,
  currentShardTotal: null,
  importStats: null
});

export const createProgressState = ({ logWindowSize = 20, logHistorySize = 50 } = {}) => {
  return {
    logWindowSize,
    logHistorySize,
    logLines: Array(logWindowSize).fill(''),
    logLineTags: Array(logWindowSize).fill(''),
    logHistory: [],
    logUpdateByTag: new Map(),
    logUpdateDebounceMs: 250,
    metricsLine: '',
    progressLine: '',
    fileProgressLine: '',
    progressLineBase: '',
    progressLinePrefix: '',
    progressLineSuffix: '',
    progressElapsedStartMs: null,
    lastProgressRefreshMs: 0,
    progressRefreshMs: 1000,
    statusRendered: false,
    lastProgressLogged: '',
    lastProgressMessage: '',
    lastMetricsLogged: '',
    shardByLabel: new Map(),
    activeShards: new Map(),
    activeShardWindowMs: 5000,
    build: createBuildProgressState(),
    currentRepoLabel: ''
  };
};

export const resetBuildProgressState = (state, label = '') => {
  state.build = createBuildProgressState();
  state.build.label = label;
  state.shardByLabel.clear();
  state.activeShards.clear();
  state.logUpdateByTag.clear();
};
