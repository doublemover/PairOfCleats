const toArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
};

export const createDisplayState = () => ({
  tasks: new Map(),
  taskOrder: [],
  logLines: [],
  statusLine: '',
  lastLogKey: '',
  lastLogCount: 0,
  lastLogIndex: -1,
  rendered: false,
  renderLines: 0,
  renderFrame: [],
  lastRenderMs: 0,
  lastProgressLogMs: 0,
  paletteOffset: null,
  paletteScheme: null,
  paletteStep: null,
  paletteSlots: new Map(),
  paletteOrder: [],
  rateMaxByTask: new Map(),
  hueShiftByTask: new Map()
});

export const pushLogLine = (state, line, logWindowSize) => {
  if (state.logLines.length >= logWindowSize) state.logLines.shift();
  state.logLines.push(line);
};

export const upsertLogLine = (state, line) => {
  if (state.lastLogIndex >= 0 && state.lastLogIndex < state.logLines.length) {
    state.logLines[state.lastLogIndex] = line;
    return true;
  }
  return false;
};

export const ensureDisplayTask = (state, id, name, meta = {}, now = Date.now()) => {
  if (state.tasks.has(id)) {
    return { task: state.tasks.get(id), created: false };
  }
  const task = {
    id,
    name: name || id,
    current: 0,
    total: Number.isFinite(meta.total) ? meta.total : null,
    unit: meta.unit || null,
    stage: meta.stage || null,
    mode: meta.mode || null,
    status: 'running',
    message: meta.message || null,
    ephemeral: meta.ephemeral === true,
    startedAt: now,
    lastUpdateMs: now,
    endedAt: null
  };
  state.tasks.set(id, task);
  state.taskOrder.push(id);
  return { task, created: true };
};

export const removeDisplayTask = (state, task) => {
  if (!task || !state.tasks.has(task.id)) return;
  state.tasks.delete(task.id);
  const index = state.taskOrder.indexOf(task.id);
  if (index >= 0) state.taskOrder.splice(index, 1);
};

export const resetDisplayTasks = (state, { preserveStages = [], preserveIds = [] } = {}) => {
  const stageSet = new Set(
    toArray(preserveStages)
      .map((stage) => String(stage).trim().toLowerCase())
      .filter(Boolean)
  );
  const idSet = new Set(toArray(preserveIds).map((id) => String(id)));
  const preserved = [];
  for (const id of state.taskOrder) {
    const task = state.tasks.get(id);
    if (!task) continue;
    const stage = String(task.stage || '').trim().toLowerCase();
    if (idSet.has(id) || (stage && stageSet.has(stage))) {
      preserved.push(task);
    }
  }
  state.tasks.clear();
  state.taskOrder.length = 0;
  state.paletteSlots.clear();
  state.paletteOrder.length = 0;
  state.rateMaxByTask.clear();
  for (const task of preserved) {
    state.tasks.set(task.id, task);
    state.taskOrder.push(task.id);
  }
};

export const applyDisplayTaskUpdate = (task, update = {}, now = Date.now()) => {
  if (Number.isFinite(update.current)) task.current = update.current;
  if (Number.isFinite(update.total)) task.total = update.total;
  if (typeof update.name === 'string' && update.name.trim()) task.name = update.name;
  if (typeof update.status === 'string') task.status = update.status;
  if (typeof update.message === 'string') task.message = update.message;
  if (typeof update.stage === 'string') task.stage = update.stage;
  if (typeof update.mode === 'string') task.mode = update.mode;
  if (update.extra && typeof update.extra === 'object') task.extra = update.extra;
  if (task.status === 'running' && update.status) task.endedAt = null;
  if ((task.status === 'done' || task.status === 'failed') && !Number.isFinite(task.endedAt)) {
    task.endedAt = now;
  }
  task.lastUpdateMs = now;
};
