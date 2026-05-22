import { normalizeProgressMode, resolveTerminal } from './display/terminal.js';
import { formatCount } from './display/text.js';
import { renderDisplay } from './display/render.js';
import { createSafeWritableStream } from './display/stream.js';
import { writeDisplayLogEvent, writeDisplayTaskEvent } from './display/events.js';
import {
  applyDisplayTaskUpdate,
  createDisplayState,
  ensureDisplayTask,
  pushLogLine,
  removeDisplayTask,
  resetDisplayTasks,
  upsertLogLine
} from './display/state.js';
import { getProgressContext } from '../env.js';

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

  const state = createDisplayState();

  const writeJsonLog = (level, message, meta) => {
    writeDisplayLogEvent(stream, contextPatch, level, message, meta);
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
      || baseLine.startsWith('Writing index files');
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
      if (!upsertLogLine(state, nextLine)) pushLogLine(state, nextLine, logWindowSize);
    } else {
      state.lastLogKey = key;
      state.lastLogCount = 1;
      state.lastLogIndex = state.logLines.length;
      pushLogLine(state, line, logWindowSize);
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
    writeDisplayTaskEvent(stream, contextPatch, event, task, extra);
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
    const { task, created } = ensureDisplayTask(state, id, name, meta);
    if (created) {
      if (jsonl) emitTaskEvent('task:start', task, { total: task.total });
      scheduleRender();
    }
    return task;
  };

  const removeTask = (task) => {
    removeDisplayTask(state, task);
  };

  const resetTasks = ({ preserveStages = [], preserveIds = [] } = {}) => {
    resetDisplayTasks(state, { preserveStages, preserveIds });
    scheduleRender();
  };

  const updateTask = (task, update = {}) => {
    applyDisplayTaskUpdate(task, update);
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
