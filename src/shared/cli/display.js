import { writeProgressEvent } from './progress-events.js';
import { normalizeProgressMode, resolveTerminal } from './display/terminal.js';
import { formatCount } from './display/text.js';
import { renderDisplay } from './display/render.js';
import { getProgressContext } from '../env.js';
import { isClosedStreamWriteError } from '../jsonrpc.js';

const createSafeWritableStream = (target) => {
  if (!target || typeof target.write !== 'function') {
    return {
      stream: target,
      isWritable: () => false,
      close: () => {}
    };
  }
  let closed = false;
  const markClosed = () => { closed = true; };
  const isStreamWritable = () => !closed && target && !target.destroyed && !target.writableEnded;
  const safeWrite = (...args) => {
    if (!isStreamWritable()) {
      markClosed();
      return false;
    }
    try {
      return target.write.apply(target, args);
    } catch (err) {
      if (isClosedStreamWriteError(err)) {
        markClosed();
        return false;
      }
      throw err;
    }
  };
  const handleError = (err) => {
    if (isClosedStreamWriteError(err)) {
      markClosed();
    }
  };
  const removeListener = typeof target.off === 'function'
    ? (event, handler) => target.off(event, handler)
    : (typeof target.removeListener === 'function'
      ? (event, handler) => target.removeListener(event, handler)
      : null);
  if (typeof target.on === 'function') {
    target.on('close', markClosed);
    target.on('finish', markClosed);
    target.on('error', handleError);
  }
  const proxyHandler = {
    get(obj, prop, receiver) {
      if (prop === 'write') return safeWrite;
      const value = Reflect.get(obj, prop, receiver);
      return typeof value === 'function' ? value.bind(obj) : value;
    }
  };
  const close = () => {
    markClosed();
    if (!removeListener) return;
    removeListener('close', markClosed);
    removeListener('finish', markClosed);
    removeListener('error', handleError);
  };
  return {
    stream: new Proxy(target, proxyHandler),
    isWritable: isStreamWritable,
    close
  };
};

export function createDisplay(options = {}) {
  const safeStream = createSafeWritableStream(options.stream || process.stderr);
  const stream = safeStream.stream;
  const isTTY = options.isTTY !== undefined ? options.isTTY : !!stream.isTTY;
  const verbose = options.verbose === true;
  const quiet = options.quiet === true;
  const json = options.json === true;
  const requestedProgressMode = normalizeProgressMode(options.progressMode || 'auto');
  const progressMode = (requestedProgressMode === 'tty' && !isTTY) ? 'log' : requestedProgressMode;
  const interactive = (progressMode === 'auto' || progressMode === 'tty') && isTTY && !json;
  const jsonl = progressMode === 'jsonl';
  const progressEnabled = progressMode !== 'off';
  const term = interactive ? resolveTerminal(stream) : null;
  const canRender = !!(term && typeof term.up === 'function' && typeof term.eraseLine === 'function');
  const colorEnabled = interactive && canRender && !jsonl;
  const logWindowSize = Number.isFinite(options.logWindowSize)
    ? Math.max(3, Math.floor(options.logWindowSize))
    : 6;
  const renderMinIntervalMs = Number.isFinite(options.renderMinIntervalMs)
    ? Math.max(16, Math.floor(options.renderMinIntervalMs))
    : 80;
  const progressLogIntervalMs = Number.isFinite(options.progressLogIntervalMs)
    ? Math.max(100, Math.floor(options.progressLogIntervalMs))
    : 1000;
  const progressContext = options.progressContext && typeof options.progressContext === 'object'
    ? options.progressContext
    : (getProgressContext() || null);
  const contextPatch = progressContext && typeof progressContext === 'object'
    ? {
      ...(progressContext.runId ? { runId: progressContext.runId } : {}),
      ...(progressContext.jobId ? { jobId: progressContext.jobId } : {})
    }
    : {};

  const state = {
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
  };

  const writeJsonLog = (level, message, meta) => {
    writeProgressEvent(stream, 'log', {
      ...contextPatch,
      level,
      message,
      meta: meta && typeof meta === 'object' ? meta : null
    });
  };

  const pushLogLine = (line) => {
    if (state.logLines.length >= logWindowSize) state.logLines.shift();
    state.logLines.push(line);
  };

  const upsertLogLine = (line) => {
    if (state.lastLogIndex >= 0 && state.lastLogIndex < state.logLines.length) {
      state.logLines[state.lastLogIndex] = line;
      return true;
    }
    return false;
  };

  const appendLog = (level, message, meta) => {
    if (jsonl) {
      writeJsonLog(level, message, meta);
      return;
    }
    const forceOutput = meta && typeof meta === 'object' && meta.forceOutput === true;
    if (quiet && level !== 'error' && !forceOutput) return;
    const baseLine = message || '';
    const prefix = level === 'warn' ? '[warn] ' : (level === 'error' ? '[error] ' : '');
    const line = `${prefix}${baseLine}`.trim();
    const isStatusLine = (meta && typeof meta === 'object' && meta.kind === 'status')
      || baseLine.startsWith('Writing index files')
      || baseLine.startsWith('[embeddings]')
      || baseLine.includes('embeddings]') && baseLine.includes('processed') && baseLine.includes('files');
    if (isStatusLine) {
      state.statusLine = line;
      if (interactive && canRender) {
        scheduleRender();
        return;
      }
      stream.write(`${line}\n`);
      return;
    }
    const key = `${level}|${line}`;
    if (key && key === state.lastLogKey) {
      state.lastLogCount += 1;
      const nextLine = `${line} (x${state.lastLogCount})`;
      if (!upsertLogLine(nextLine)) pushLogLine(nextLine);
    } else {
      state.lastLogKey = key;
      state.lastLogCount = 1;
      state.lastLogIndex = state.logLines.length;
      pushLogLine(line);
    }
    if (interactive && canRender) {
      scheduleRender();
      return;
    }
    stream.write(`${line}\n`);
  };

  const render = () => renderDisplay({
    state,
    term,
    stream,
    interactive,
    canRender,
    colorEnabled,
    logWindowSize
  });

  const scheduleRender = () => {
    const now = Date.now();
    if (now - state.lastRenderMs < renderMinIntervalMs) return;
    state.lastRenderMs = now;
    render();
  };

  const emitTaskEvent = (event, task, extra = {}) => {
    if (!progressEnabled) return;
    writeProgressEvent(stream, event, {
      ...contextPatch,
      taskId: task.id,
      name: task.name,
      current: task.current,
      total: task.total,
      unit: task.unit || null,
      stage: task.stage || null,
      mode: task.mode || null,
      status: task.status || null,
      message: task.message || null,
      ...extra
    });
  };

  const maybeLogProgressLine = (task) => {
    if (interactive || !progressEnabled || jsonl) return;
    const now = Date.now();
    if (now - state.lastProgressLogMs < progressLogIntervalMs && task.status !== 'done') return;
    state.lastProgressLogMs = now;
    const total = Number.isFinite(task.total) && task.total > 0 ? task.total : null;
    const current = Number.isFinite(task.current) ? task.current : 0;
    const suffix = total ? `${formatCount(current)}/${formatCount(total)}` : formatCount(current);
    const label = task.mode ? `${task.mode} ${task.name}` : task.name;
    const status = task.status && task.status !== 'running' ? ` (${task.status})` : '';
    const message = task.message ? ` ${task.message}` : '';
    stream.write(`${label} ${suffix}${status}${message}\n`);
  };

  const ensureTask = (id, name, meta = {}) => {
    if (state.tasks.has(id)) return state.tasks.get(id);
    const createdAt = Date.now();
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
      startedAt: createdAt,
      lastUpdateMs: createdAt,
      endedAt: null
    };
    state.tasks.set(id, task);
    state.taskOrder.push(id);
    if (jsonl) emitTaskEvent('task:start', task, { total: task.total });
    scheduleRender();
    return task;
  };

  const removeTask = (task) => {
    if (!task || !state.tasks.has(task.id)) return;
    state.tasks.delete(task.id);
    const index = state.taskOrder.indexOf(task.id);
    if (index >= 0) state.taskOrder.splice(index, 1);
  };

  const resetTasks = ({ preserveStages = [], preserveIds = [] } = {}) => {
    const stageSet = new Set(
      (preserveStages || [])
        .map((stage) => String(stage).trim().toLowerCase())
        .filter(Boolean)
    );
    const idSet = new Set((preserveIds || []).map((id) => String(id)));
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
    scheduleRender();
  };

  const updateTask = (task, update = {}) => {
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
      task.endedAt = Date.now();
    }
    task.lastUpdateMs = Date.now();
    if (jsonl) emitTaskEvent('task:progress', task, update.extra || {});
    if (task.ephemeral && (task.status === 'done' || task.status === 'failed')) {
      removeTask(task);
    }
    scheduleRender();
    maybeLogProgressLine(task);
  };

  const taskFactory = (name, meta = {}) => {
    const taskId = meta.taskId || `${meta.stage || ''}:${meta.mode || ''}:${name}`.replace(/:+/g, ':');
    const task = ensureTask(taskId, name, meta);
    return {
      tick(count = 1) {
        const next = Number.isFinite(task.current) ? task.current + count : count;
        updateTask(task, { current: next, total: task.total });
        if (task.total && next >= task.total) {
          updateTask(task, { status: 'done' });
          if (jsonl) emitTaskEvent('task:end', task, { status: 'done' });
        }
      },
      set(current, total = task.total, extra = null) {
        updateTask(task, {
          current,
          total,
          message: extra?.message,
          name: extra?.name,
          extra
        });
        if (total && current >= total) {
          updateTask(task, { status: 'done' });
          if (jsonl) emitTaskEvent('task:end', task, { status: 'done' });
        }
      },
      done(extra = null) {
        updateTask(task, { status: 'done', message: extra?.message, name: extra?.name });
        if (jsonl) emitTaskEvent('task:end', task, { status: 'done', ...extra });
      },
      fail(err) {
        const message = err?.message || String(err || 'error');
        updateTask(task, { status: 'failed', message });
        if (jsonl) emitTaskEvent('task:end', task, { status: 'failed', message });
      },
      update(extra = {}) {
        updateTask(task, { message: extra.message, name: extra?.name, extra });
      }
    };
  };

  const showProgress = (step, current, total, meta = null) => {
    if (!progressEnabled) return;
    const safeMeta = meta && typeof meta === 'object' ? meta : {};
    const taskId = safeMeta.taskId || [safeMeta.stage, safeMeta.mode, step].filter(Boolean).join(':') || step;
    const task = ensureTask(taskId, step, { ...safeMeta, total });
    updateTask(task, { current, total, message: safeMeta.message, extra: safeMeta });
    if (total && current >= total) {
      updateTask(task, { status: 'done' });
      if (jsonl) emitTaskEvent('task:end', task, { status: 'done' });
    }
  };

  const log = (message, meta = null) => appendLog('info', message, meta);
  const warn = (message, meta = null) => appendLog('warn', message, meta);
  const error = (message, meta = null) => appendLog('error', message, meta);

  const logLine = (message, meta = null) => {
    const kind = meta && typeof meta === 'object' ? meta.kind : '';
    if (kind === 'file-progress' || kind === 'line-progress') {
      if (!verbose) return;
    }
    log(message, meta);
  };

  const close = () => {
    safeStream.close?.();
    if (!interactive || !term) return;
    if (typeof term.showCursor === 'function') term.showCursor();
    if (canRender) {
      term.eraseLine();
    }
  };

  const flush = () => {
    if (!interactive || !canRender) return;
    render();
  };

  if (interactive && term && typeof term.hideCursor === 'function') {
    term.hideCursor();
  }

  return {
    progressMode,
    interactive,
    jsonl,
    log,
    info: log,
    warn,
    error,
    logError: error,
    logLine,
    showProgress,
    task: taskFactory,
    resetTasks,
    flush,
    close
  };
}
