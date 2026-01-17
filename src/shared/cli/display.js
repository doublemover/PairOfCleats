import terminalKitModule from 'terminal-kit';
import { writeProgressEvent } from './progress-events.js';

const terminalKit = terminalKitModule?.default || terminalKitModule;

const normalizeProgressMode = (value) => {
  if (value === false || value === 'false' || value === 'off' || value === 'none') return 'off';
  if (value === 'jsonl' || value === 'json') return 'jsonl';
  return 'auto';
};

const resolveTerminal = (stream) => {
  if (!terminalKit) return null;
  if (typeof terminalKit.createTerminal === 'function') {
    return terminalKit.createTerminal({
      stdin: process.stdin,
      stdout: stream,
      stderr: stream
    });
  }
  if (terminalKit.terminal) {
    const term = terminalKit.terminal;
    if (term.stdout && term.stdout !== stream) term.stdout = stream;
    if (term.outputStream && term.outputStream !== stream) term.outputStream = stream;
    return term;
  }
  return null;
};

const formatCount = (value) => {
  if (!Number.isFinite(value)) return '?';
  return value.toLocaleString();
};

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
const stripAnsi = (value) => String(value || '').replace(ANSI_PATTERN, '');

const PARTIALS_FINE = ['▏', '▎', '▍', '▌', '▋', '▊', '▉'];
const PARTIALS_MED = ['▎', '▌', '▊'];
const PARTIALS_COARSE = ['▌'];
const BRAILLE_RAMP = ['⡀', '⡄', '⡆', '⡇', '⣇', '⣧', '⣷'];

const BAR_STYLES = {
  overall: { fill: '⣿', empty: '·', partials: BRAILLE_RAMP },
  stage: { fill: '▓', empty: '░', partials: PARTIALS_COARSE },
  files: { fill: '⣿', empty: '·', partials: BRAILLE_RAMP },
  shard: { fill: '⣿', empty: '·', partials: BRAILLE_RAMP },
  imports: { fill: '▆', empty: '·', partials: PARTIALS_MED },
  artifacts: { fill: '▇', empty: '·', partials: PARTIALS_MED },
  records: { fill: '▅', empty: '·', partials: PARTIALS_MED },
  embeddings: { fill: '⣿', empty: '·', partials: BRAILLE_RAMP },
  downloads: { fill: '▇', empty: '·', partials: PARTIALS_MED },
  ci: { fill: '▓', empty: '░', partials: PARTIALS_COARSE },
  default: { fill: '⣿', empty: '·', partials: BRAILLE_RAMP }
};

const BAR_THEMES = {
  overall: { fill: '38;5;24', edge: '38;5;25', empty: '38;5;238', bracket: '97' },
  stage: { fill: '38;5;240', edge: '38;5;244', empty: '38;5;238', bracket: '97' },
  files: { fill: '38;5;22', edge: '38;5;28', empty: '38;5;238', bracket: '97' },
  shard: { fill: '38;5;23', edge: '38;5;30', empty: '38;5;238', bracket: '97' },
  imports: { fill: '38;5;58', edge: '38;5;64', empty: '38;5;238', bracket: '97' },
  artifacts: { fill: '38;5;54', edge: '38;5;55', empty: '38;5;238', bracket: '97' },
  records: { fill: '38;5;30', edge: '38;5;31', empty: '38;5;238', bracket: '97' },
  embeddings: { fill: '38;5;60', edge: '38;5;61', empty: '38;5;238', bracket: '97' },
  downloads: { fill: '38;5;24', edge: '38;5;25', empty: '38;5;238', bracket: '97' },
  ci: { fill: '38;5;236', edge: '38;5;240', empty: '38;5;238', bracket: '97' },
  default: { fill: '38;5;24', edge: '38;5;25', empty: '38;5;238', bracket: '97' }
};

const resolveBarVariant = (task) => {
  const name = String(task?.name || '').toLowerCase();
  const stage = String(task?.stage || '').toLowerCase();
  if (stage === 'overall' || name === 'overall') return 'overall';
  if (name === 'stage') return 'stage';
  if (name === 'files') return 'files';
  if (name === 'shard') return 'shard';
  if (name === 'imports') return 'imports';
  if (name === 'artifacts') return 'artifacts';
  if (name === 'records') return 'records';
  if (name === 'downloads') return 'downloads';
  if (name === 'embeddings' || stage === 'embeddings') return 'embeddings';
  if (name === 'ci' || stage === 'ci') return 'ci';
  return 'default';
};

const buildBar = (pct, width, style, theme, colorize) => {
  const safeWidth = Math.max(4, Math.floor(width));
  const clamped = Math.min(1, Math.max(0, pct));
  const total = clamped * safeWidth;
  const fullCount = Math.floor(total);
  const remainder = total - fullCount;
  const partials = Array.isArray(style?.partials) && style.partials.length
    ? style.partials
    : PARTIALS_FINE;
  let partialIndex = Math.floor(remainder * partials.length);
  if (remainder > 0 && partialIndex === 0) partialIndex = 1;
  if (partialIndex >= partials.length) partialIndex = partials.length;
  const hasPartial = partialIndex > 0 && fullCount < safeWidth;
  const emptyCount = Math.max(0, safeWidth - fullCount - (hasPartial ? 1 : 0));

  const fillChar = style?.fill || '█';
  const emptyChar = style?.empty || '·';
  const filledText = fullCount > 0 ? fillChar.repeat(fullCount) : '';
  const partialText = hasPartial ? partials[partialIndex - 1] : '';
  const emptyText = emptyCount > 0 ? emptyChar.repeat(emptyCount) : '';

  const filled = colorize ? colorize(filledText, theme?.fill) : filledText;
  const partial = colorize ? colorize(partialText, theme?.edge) : partialText;
  const empty = colorize ? colorize(emptyText, theme?.empty) : emptyText;
  const bracket = theme?.bracket || '97';
  const left = colorize ? colorize('[', bracket) : '[';
  const right = colorize ? colorize(']', bracket) : ']';
  return `${left}${filled}${partial}${empty}${right}`;
};

const resolveWidth = (term, stream) => {
  if (term && Number.isFinite(term.width)) return term.width;
  if (stream && Number.isFinite(stream.columns)) return stream.columns;
  return 120;
};

const truncateLine = (line, width) => {
  if (!line) return '';
  const safeWidth = Math.max(1, Math.floor(width));
  const plain = stripAnsi(line);
  if (plain.length <= safeWidth) return line;
  if (safeWidth <= 3) return plain.slice(0, safeWidth);
  return `${plain.slice(0, safeWidth - 3)}...`;
};

const clampRatio = (value) => Math.min(1, Math.max(0, value));

const progressRatio = (task) => {
  if (!task || !Number.isFinite(task.total) || task.total <= 0) return 0;
  const current = Number.isFinite(task.current) ? task.current : 0;
  return clampRatio(current / task.total);
};

const computeOverallProgress = ({ overallTask, tasksByMode }) => {
  if (!overallTask || !Number.isFinite(overallTask.total) || overallTask.total <= 0) return null;
  let computed = 0;
  for (const [mode, stageTask] of tasksByMode.stage) {
    if (!stageTask || !Number.isFinite(stageTask.total) || stageTask.total <= 0) continue;
    const stageTotal = stageTask.total;
    if (stageTask.status === 'done') {
      computed += stageTotal;
      continue;
    }
    const stageIndex = Number.isFinite(stageTask.current) ? stageTask.current : 0;
    const completed = Math.max(0, Math.min(stageTotal, stageIndex - 1));
    const stageId = String(stageTask.stage || '').toLowerCase();
    let fraction = 0;
    if (stageId === 'imports') {
      fraction = progressRatio(tasksByMode.imports.get(mode));
    } else if (stageId === 'processing') {
      const filesFraction = progressRatio(tasksByMode.files.get(mode));
      const shardFraction = progressRatio(tasksByMode.shard.get(mode));
      fraction = Math.max(filesFraction, shardFraction);
    } else if (stageId === 'write') {
      fraction = progressRatio(tasksByMode.artifacts.get(mode));
    }
    computed += completed + fraction;
  }
  const overallCurrent = Number.isFinite(overallTask.current) ? overallTask.current : 0;
  const effective = Math.max(computed, overallCurrent);
  return clampRatio(effective / overallTask.total);
};

const padLabel = (label, width) => {
  const safeWidth = Math.max(1, Math.floor(width));
  const plain = stripAnsi(label);
  if (plain.length === safeWidth) return label;
  if (plain.length < safeWidth) return `${label}${' '.repeat(safeWidth - plain.length)}`;
  if (safeWidth <= 3) return plain.slice(0, safeWidth);
  return `${plain.slice(0, safeWidth - 3)}...`;
};

export function createDisplay(options = {}) {
  const stream = options.stream || process.stderr;
  const isTTY = options.isTTY !== undefined ? options.isTTY : !!stream.isTTY;
  const verbose = options.verbose === true;
  const quiet = options.quiet === true;
  const json = options.json === true;
  const progressMode = normalizeProgressMode(options.progressMode || 'auto');
  const interactive = progressMode === 'auto' && isTTY && !json;
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

  const state = {
    tasks: new Map(),
    taskOrder: [],
    logLines: [],
    lastLogKey: '',
    lastLogCount: 0,
    lastLogIndex: -1,
    rendered: false,
    renderLines: 0,
    lastRenderMs: 0,
    lastProgressLogMs: 0
  };

  const writeJsonLog = (level, message, meta) => {
    writeProgressEvent(stream, 'log', {
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
    if (quiet && level !== 'error') return;
    const baseLine = message || '';
    const prefix = level === 'warn' ? '[warn] ' : (level === 'error' ? '[error] ' : '');
    const line = `${prefix}${baseLine}`.trim();
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

  const render = () => {
    if (!interactive || !canRender) return;
    const width = resolveWidth(term, stream);
    const tasks = state.taskOrder.map((id, order) => ({ task: state.tasks.get(id), order }))
      .filter((entry) => entry.task);
    tasks.sort((a, b) => b.order - a.order);
    const orderedTasks = tasks.map((entry) => entry.task);
    const taskLabels = orderedTasks.map((task) => {
      const labelParts = [];
      if (task.mode) labelParts.push(task.mode);
      labelParts.push(task.name);
      return labelParts.join(' ');
    });
    const baselineLabels = [
      'extracted-prose Artifacts',
      'extracted-prose Files',
      'extracted-prose Stage',
      'extracted-prose Imports',
      'extracted-prose Shard',
      'records Records'
    ];
    const maxLabelLength = [...taskLabels, ...baselineLabels]
      .reduce((max, label) => Math.max(max, stripAnsi(label).length), 0);
    const labelWidth = Math.min(maxLabelLength, Math.max(10, Math.floor(width * 0.22)));
    const tasksByMode = {
      stage: new Map(),
      imports: new Map(),
      files: new Map(),
      shard: new Map(),
      artifacts: new Map()
    };
    let overallTask = null;
    for (const task of orderedTasks) {
      const name = String(task.name || '').toLowerCase();
      const stage = String(task.stage || '').toLowerCase();
      if (name === 'overall' || stage === 'overall') {
        overallTask = task;
      }
      if (!task.mode) continue;
      if (name === 'stage') tasksByMode.stage.set(task.mode, task);
      if (name === 'imports') tasksByMode.imports.set(task.mode, task);
      if (name === 'files') tasksByMode.files.set(task.mode, task);
      if (name === 'shard') tasksByMode.shard.set(task.mode, task);
      if (name === 'artifacts') tasksByMode.artifacts.set(task.mode, task);
    }
    const overallOverride = computeOverallProgress({ overallTask, tasksByMode });
    const taskLines = orderedTasks.map((task, index) => {
      const total = Number.isFinite(task.total) && task.total > 0 ? task.total : null;
      const current = Number.isFinite(task.current) ? task.current : 0;
      let pct = total ? current / total : 0;
      if (overallOverride !== null && task === overallTask) {
        pct = overallOverride;
      }
      const suffix = total ? `${formatCount(current)}/${formatCount(total)}` : formatCount(current);
      const barWidth = Math.min(42, Math.max(16, Math.floor(width / 4)));
      const colorize = colorEnabled
        ? (text, code) => (text && code ? `\x1b[${code}m${text}\x1b[0m` : text || '')
        : null;
      const variant = resolveBarVariant(task);
      const style = BAR_STYLES[variant] || BAR_STYLES.default;
      const theme = BAR_THEMES[variant] || BAR_THEMES.default;
      const bar = total ? buildBar(clampRatio(pct), barWidth, style, theme, colorize) : '[-]';
      const label = padLabel(taskLabels[index] || task.name, labelWidth);
      const status = task.status && task.status !== 'running' ? ` (${task.status})` : '';
      const message = task.message ? ` ${task.message}` : '';
      return `${label} ${bar} ${suffix}${status}${message}`.trim();
    });

    const logLines = [...state.logLines];
    while (logLines.length < logWindowSize) logLines.push('');
    const lines = [...logLines, ...taskLines];
    const totalLines = lines.length;

    if (!state.rendered) {
      term('\n'.repeat(totalLines));
      state.rendered = true;
      state.renderLines = totalLines;
    } else if (totalLines > state.renderLines) {
      term('\n'.repeat(totalLines - state.renderLines));
      state.renderLines = totalLines;
    }

    term.up(state.renderLines);
    for (const rawLine of lines) {
      term.eraseLine();
      term(truncateLine(rawLine || '', width));
      term('\n');
    }
  };

  const scheduleRender = () => {
    const now = Date.now();
    if (now - state.lastRenderMs < renderMinIntervalMs) return;
    state.lastRenderMs = now;
    render();
  };

  const emitTaskEvent = (event, task, extra = {}) => {
    if (!progressEnabled) return;
    writeProgressEvent(stream, event, {
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
      ephemeral: meta.ephemeral === true
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

  const updateTask = (task, update = {}) => {
    if (Number.isFinite(update.current)) task.current = update.current;
    if (Number.isFinite(update.total)) task.total = update.total;
    if (typeof update.status === 'string') task.status = update.status;
    if (typeof update.message === 'string') task.message = update.message;
    if (typeof update.stage === 'string') task.stage = update.stage;
    if (typeof update.mode === 'string') task.mode = update.mode;
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
        updateTask(task, { current, total, message: extra?.message, extra });
        if (total && current >= total) {
          updateTask(task, { status: 'done' });
          if (jsonl) emitTaskEvent('task:end', task, { status: 'done' });
        }
      },
      done(extra = null) {
        updateTask(task, { status: 'done', message: extra?.message });
        if (jsonl) emitTaskEvent('task:end', task, { status: 'done', ...extra });
      },
      fail(err) {
        const message = err?.message || String(err || 'error');
        updateTask(task, { status: 'failed', message });
        if (jsonl) emitTaskEvent('task:end', task, { status: 'failed', message });
      },
      update(extra = {}) {
        updateTask(task, { message: extra.message, extra });
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
    if (!interactive || !term) return;
    if (typeof term.showCursor === 'function') term.showCursor();
    if (canRender) {
      term.eraseLine();
    }
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
    close
  };
}
