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

const PARTIALS_OVERALL = ['▊', '▋', '▌', '▍', '▎', '▏'];
const PARTIALS_STAGE = ['▖', '▘', '▝', '▗', '▚', '▞'];
const PARTIALS_IMPORTS = ['░', '▒', '▓'];
const PARTIALS_FILES = ['⠁', '⠃', '⠇', '⡇', '⡏', '⡟', '⡿'];
const PARTIALS_ARTIFACTS = ['⡈', '⡘', '⡸', '⣸'];
const PARTIALS_REPOS = ['▂', '▃', '▄', '▅', '▆', '▇'];
const PARTIALS_DEFAULT = ['⡁', '⡃', '⡇', '⡧', '⡷'];
const EMPTY_PATTERN_DEFAULT = '┈┉';

const BAR_STYLES = {
  overall: { fill: '▉', empty: ' ', partials: PARTIALS_OVERALL },
  stage: { fill: '█', empty: ' ', partials: PARTIALS_STAGE },
  imports: { fill: '█', empty: ' ', partials: PARTIALS_IMPORTS },
  files: { fill: '⣿', empty: ' ', partials: PARTIALS_FILES },
  artifacts: { fill: '⣿', empty: ' ', partials: PARTIALS_ARTIFACTS },
  shard: { fill: '⣿', empty: ' ', partials: PARTIALS_FILES },
  records: { fill: '█', empty: ' ', partials: PARTIALS_REPOS },
  embeddings: { fill: '█', empty: ' ', partials: PARTIALS_STAGE },
  downloads: { fill: '█', empty: ' ', partials: PARTIALS_REPOS },
  repos: { fill: '█', empty: ' ', partials: PARTIALS_REPOS },
  queries: { fill: '█', empty: ' ', partials: PARTIALS_REPOS },
  ci: { fill: '█', empty: ' ', partials: PARTIALS_STAGE },
  default: { fill: '⣿', empty: EMPTY_PATTERN_DEFAULT, partials: PARTIALS_DEFAULT }
};

const OFF_WHITE = { r: 235, g: 236, b: 238 };
const BLACK = { r: 0, g: 0, b: 0 };
const CHECK_FG_OK = { r: 84, g: 196, b: 108 };
const CHECK_FG_FAIL = { r: 220, g: 96, b: 96 };

const resolveBarVariant = (task) => {
  const name = String(task?.name || '').toLowerCase();
  const stage = String(task?.stage || '').toLowerCase();
  if (stage === 'overall' || name === 'overall') return 'overall';
  if (name === 'stage') return 'stage';
  if (name === 'repos' || stage === 'bench') return 'repos';
  if (name === 'queries' || stage === 'queries' || stage === 'query') return 'queries';
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

const repeatPattern = (pattern, count) => {
  if (!pattern || count <= 0) return '';
  const safe = String(pattern);
  if (safe.length === 1) return safe.repeat(count);
  let output = '';
  for (let i = 0; i < count; i += 1) {
    output += safe[i % safe.length];
  }
  return output;
};

const clampChannel = (value) => Math.max(0, Math.min(255, Math.round(value)));

const mixChannel = (from, to, t) => clampChannel(from + (to - from) * t);

const mixColor = (from, to, t) => ({
  r: mixChannel(from.r, to.r, t),
  g: mixChannel(from.g, to.g, t),
  b: mixChannel(from.b, to.b, t)
});

const scaleColor = (color, factor) => ({
  r: clampChannel(color.r * factor),
  g: clampChannel(color.g * factor),
  b: clampChannel(color.b * factor)
});

const lightenColor = (color, factor) => mixColor(color, { r: 255, g: 255, b: 255 }, factor);

const toLinear = (value) => {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

const relativeLuminance = (color) => {
  const r = toLinear(color.r);
  const g = toLinear(color.g);
  const b = toLinear(color.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const clampBackgroundColor = (color, maxLuma = 0.6) => {
  const lum = relativeLuminance(color);
  if (lum <= maxLuma) return color;
  const factor = maxLuma / (lum || 1);
  return scaleColor(color, factor);
};

const buildShadeScale = (base) => {
  const light = clampBackgroundColor(lightenColor(base, 0.3));
  const dark = clampBackgroundColor(scaleColor(base, 0.7));
  const shades = [];
  for (let i = 0; i <= 25; i += 1) {
    shades.push(clampBackgroundColor(mixColor(light, dark, i / 25)));
  }
  return shades;
};

const colorToAnsi = (color, isBackground = false) => {
  const prefix = isBackground ? '48' : '38';
  return `${prefix};2;${color.r};${color.g};${color.b}`;
};

const PALETTE = [
  { r: 41, g: 86, b: 70 },
  { r: 43, g: 95, b: 87 },
  { r: 44, g: 99, b: 104 },
  { r: 45, g: 93, b: 113 },
  { r: 46, g: 84, b: 122 },
  { r: 46, g: 71, b: 132 },
  { r: 47, g: 53, b: 142 },
  { r: 62, g: 47, b: 152 },
  { r: 88, g: 46, b: 162 },
  { r: 118, g: 46, b: 173 },
  { r: 154, g: 45, b: 184 },
  { r: 195, g: 44, b: 195 },
  { r: 207, g: 43, b: 172 },
  { r: 215, g: 45, b: 143 },
  { r: 220, g: 50, b: 111 },
  { r: 224, g: 56, b: 81 },
  { r: 228, g: 73, b: 62 },
  { r: 232, g: 115, b: 69 },
  { r: 236, g: 155, b: 75 },
  { r: 239, g: 193, b: 82 },
  { r: 242, g: 230, b: 89 },
  { r: 225, g: 245, b: 96 },
  { r: 197, g: 248, b: 104 },
  { r: 172, g: 250, b: 112 }
];

const resolvePaletteSlot = (index, total, offset = 0, step = 1) => {
  if (!Number.isFinite(total) || total <= 1) return offset;
  return offset + index * step;
};

const paletteColorAt = (slot) => {
  const clamped = Math.max(0, Math.min(PALETTE.length - 1, slot));
  const lower = Math.floor(clamped);
  const upper = Math.min(PALETTE.length - 1, lower + 1);
  const local = clamped - lower;
  return mixColor(PALETTE[lower], PALETTE[upper], local);
};

const resolveGradientColor = (index, total, offset = 0, step = 1) => {
  const slot = resolvePaletteSlot(index, total, offset, step);
  return paletteColorAt(slot);
};

const composeColor = (foreground, background) => {
  if (foreground && background) return `${foreground};${background}`;
  return foreground || background || '';
};

const buildGradientText = (count, char, gradient, colorize, background) => {
  if (!count || !gradient || !colorize) return char.repeat(count);
  let output = '';
  for (let i = 0; i < count; i += 1) {
    const color = gradient(i, count);
    const fg = color ? colorToAnsi(color) : null;
    const code = composeColor(fg, background);
    output += colorize(char, code);
  }
  return output;
};

const buildBar = (pct, width, style, theme, colorize, options = {}) => {
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
  let hasPartial = partialIndex > 0 && fullCount < safeWidth;
  const animateIndex = Number.isFinite(options.animateIndex) ? options.animateIndex : null;
  if (animateIndex !== null && clamped < 1 && fullCount < safeWidth) {
    const animated = (Math.floor(animateIndex) % partials.length) + 1;
    partialIndex = animated;
    hasPartial = true;
  }
  const emptyCount = Math.max(0, safeWidth - fullCount - (hasPartial ? 1 : 0));

  const fillChar = style?.fill || '█';
  const emptyChar = style?.empty || '·';
  const filledText = fullCount > 0 ? repeatPattern(fillChar, fullCount) : '';
  const partialText = hasPartial ? partials[partialIndex - 1] : '';
  const emptyText = emptyCount > 0 ? repeatPattern(emptyChar, emptyCount) : '';

  const background = theme?.background || '';
  let filled = filledText;
  if (colorize && options.fillGradient && fullCount > 0) {
    filled = buildGradientText(fullCount, fillChar, options.fillGradient, colorize, background);
  } else if (colorize) {
    filled = colorize(filledText, composeColor(theme?.fill, background));
  }
  const partial = colorize ? colorize(partialText, composeColor(theme?.edge, background)) : partialText;
  const empty = colorize ? colorize(emptyText, composeColor(theme?.empty, background)) : emptyText;
  const bracketFg = theme?.bracketFg || theme?.bracket || '';
  const bracketBg = theme?.bracketBg || '';
  const bracketCode = composeColor(bracketFg, bracketBg);
  const left = colorize ? colorize('[', bracketCode) : '[';
  const right = colorize ? colorize(']', bracketCode) : ']';
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

const padVisible = (text, width) => {
  const value = String(text ?? '');
  const plainLength = stripAnsi(value).length;
  if (plainLength >= width) return value;
  return `${value}${' '.repeat(width - plainLength)}`;
};

const padVisibleStart = (text, width) => {
  const value = String(text ?? '');
  const plainLength = stripAnsi(value).length;
  if (plainLength >= width) return value;
  return `${' '.repeat(width - plainLength)}${value}`;
};

const formatDurationShort = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.max(1, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
};

const resolveRateUnit = (task) => {
  const rawUnit = typeof task?.unit === 'string' ? task.unit.trim().toLowerCase() : '';
  if (rawUnit) return rawUnit;
  const name = String(task?.name || '').toLowerCase();
  if (name.includes('file')) return 'files';
  if (name.includes('chunk')) return 'chunks';
  if (name.includes('line')) return 'lines';
  if (name.includes('query')) return 'queries';
  if (name.includes('repo')) return 'repos';
  if (name.includes('import')) return 'imports';
  if (name.includes('artifact')) return 'artifacts';
  if (name.includes('record')) return 'records';
  if (name.includes('shard')) return 'shards';
  if (name.includes('embedding')) return 'embeddings';
  if (name.includes('download')) return 'downloads';
  return '';
};

const formatRate = (rate) => {
  if (!Number.isFinite(rate) || rate <= 0) return null;
  if (rate >= 1000) {
    const scaled = rate / 1000;
    const value = scaled >= 10 ? Math.round(scaled) : Number(scaled.toFixed(1));
    return `${value}k`;
  }
  if (rate >= 100) return Math.round(rate).toLocaleString();
  if (rate >= 10) return rate.toFixed(1);
  return rate.toFixed(2);
};

const singularizeUnit = (unit) => {
  if (!unit) return '';
  return unit.endsWith('s') ? unit.slice(0, -1) : unit;
};

const titleCaseUnit = (unit) => {
  if (!unit) return '';
  return String(unit)
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() || ''}${part.slice(1)}`)
    .join('');
};

const formatSecondsPerUnit = (seconds, unit) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const safeUnit = titleCaseUnit(singularizeUnit(unit)) || 'Item';
  let value = '';
  if (seconds >= 100) value = Math.round(seconds).toLocaleString();
  else if (seconds >= 10) value = seconds.toFixed(1);
  else if (seconds >= 1) value = seconds.toFixed(2);
  else value = seconds.toFixed(3);
  return `${value}s/${safeUnit}`;
};

const splitDurationParts = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, ms: 0, totalSeconds: 0 };
  }
  if (seconds < 1) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, ms: Math.max(1, Math.round(seconds * 1000)), totalSeconds: seconds };
  }
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return { days, hours, minutes, seconds: secs, ms: 0, totalSeconds: seconds };
};

const formatDurationCompact = (parts) => {
  if (parts.ms) return `${parts.ms}ms`;
  if (parts.days > 0 || parts.hours > 0) {
    const pieces = [];
    if (parts.days > 0) pieces.push(`${parts.days}d`);
    if (parts.hours > 0) pieces.push(`${parts.hours}h`);
    if (parts.minutes > 0) pieces.push(`${parts.minutes}m`);
    if (parts.seconds > 0) pieces.push(`${parts.seconds}s`);
    return pieces.join(' ');
  }
  if (parts.minutes > 0) {
    return parts.seconds > 0 ? `${parts.minutes}m${parts.seconds}s` : `${parts.minutes}m`;
  }
  if (parts.seconds > 0) return `${parts.seconds}s`;
  return '0s';
};

const formatDurationEtaCompact = (parts) => {
  if (parts.ms) return `${parts.ms}ms`;
  if (parts.days > 0 || parts.hours > 0) {
    const pieces = [];
    if (parts.days > 0) pieces.push(`${parts.days}d`);
    if (parts.hours > 0) pieces.push(`${parts.hours}h`);
    if (parts.minutes > 0) pieces.push(`${parts.minutes}m`);
    if (parts.seconds > 0) pieces.push(`${parts.seconds}s`);
    return pieces.join('');
  }
  if (parts.minutes > 0) {
    if (parts.seconds > 0) {
      const spacer = parts.minutes >= 10 ? ' ' : '';
      return `${parts.minutes}m${spacer}${parts.seconds}s`;
    }
    return parts.minutes >= 10 ? `${parts.minutes}m   ` : `${parts.minutes}m`;
  }
  if (parts.seconds > 0) return `${parts.seconds}s`;
  return '0s';
};

const formatDurationAligned = (parts, layout) => {
  const cols = [];
  if (layout.days > 0) {
    cols.push(parts.days > 0 ? `${parts.days}d` : '');
  }
  if (layout.hours > 0) {
    cols.push(parts.hours > 0 ? `${parts.hours}h` : '');
  }
  if (layout.minutes > 0) {
    const showZero = parts.minutes === 0 && parts.seconds > 0 && parts.hours > 0;
    cols.push((parts.minutes > 0 || showZero) ? `${parts.minutes}m` : '');
  }
  if (layout.seconds > 0) {
    let value = '';
    if (parts.ms) value = `${parts.ms}ms`;
    else if (parts.seconds > 0) value = `${parts.seconds}s`;
    cols.push(value);
  }
  const padded = cols.map((value, index) => {
    const width = layout.widths[index] || 0;
    if (!width) return value;
    return padVisibleStart(value, width);
  });
  return padded.join(' ').trimEnd();
};

const buildProgressExtras = (task, now) => {
  if (!task || !Number.isFinite(task.current)) return null;
  const endAt = (task.status === 'done' || task.status === 'failed')
    ? (Number.isFinite(task.endedAt) ? task.endedAt : now)
    : now;
  const elapsedMs = Number.isFinite(task.startedAt) ? Math.max(0, endAt - task.startedAt) : 0;
  if (!elapsedMs) return null;
  const current = Math.max(0, task.current);
  const elapsedSec = elapsedMs / 1000;
  const rate = current > 0 ? current / elapsedSec : 0;
  const unit = resolveRateUnit(task);
  let rateText = null;
  if (rate > 0 && unit) {
    if (rate >= 1) {
      const rateValue = formatRate(rate);
      if (rateValue) rateText = `${rateValue} ${titleCaseUnit(unit)}/s`;
    } else {
      const perUnit = formatSecondsPerUnit(1 / rate, unit);
      if (perUnit) rateText = perUnit;
    }
  }
  let etaSec = null;
  if (task.status === 'running'
    && Number.isFinite(task.total)
    && task.total > 0
    && rate > 0
    && current > 0) {
    const remaining = Math.max(0, task.total - current);
    etaSec = remaining / rate;
  }
  if (!rateText && !etaSec && !elapsedSec) return null;
  return { rateText, etaSec, elapsedSec, rawRate: rate };
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
    statusLine: '',
    lastLogKey: '',
    lastLogCount: 0,
    lastLogIndex: -1,
    rendered: false,
    renderLines: 0,
    lastRenderMs: 0,
    lastProgressLogMs: 0,
    paletteOffset: null,
    paletteScheme: null,
    paletteStep: null,
    paletteSlots: new Map(),
    paletteOrder: []
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

  const render = () => {
    if (!interactive || !canRender) return;
    const width = resolveWidth(term, stream);
    const tasks = state.taskOrder.map((id, order) => ({ task: state.tasks.get(id), order }))
      .filter((entry) => entry.task);
    tasks.sort((a, b) => b.order - a.order);
    const orderedTasks = tasks.map((entry) => entry.task);
    const shouldHideTask = (task) => {
      if (!task) return false;
      const name = String(task.name || '').trim().toLowerCase();
      const mode = String(task.mode || '').trim().toLowerCase();
      if (mode !== 'records') return false;
      if (name !== 'records' && name !== 'files') return false;
      const total = Number.isFinite(task.total) ? task.total : null;
      const current = Number.isFinite(task.current) ? task.current : 0;
      return current <= 0 && (!total || total <= 0);
    };
    const displayTasks = orderedTasks.filter((task) => !shouldHideTask(task));
    const formatModeLabel = (mode) => {
      if (!mode) return '';
      return String(mode)
        .split(/[-_]/)
        .filter(Boolean)
        .map((part) => `${part[0]?.toUpperCase() || ''}${part.slice(1)}`)
        .join(' ');
    };
    const taskLabels = displayTasks.map((task) => {
      const labelParts = [];
      const rawName = String(task?.name || '').trim();
      const name = (task?.mode === 'records' && rawName.toLowerCase() === 'records')
        ? 'Files'
        : rawName;
      const stage = String(task?.stage || '').trim().toLowerCase();
      if (task.mode) labelParts.push(formatModeLabel(task.mode));
      if (stage === 'embeddings' && name.toLowerCase() === 'files') {
        labelParts.push('Embeddings');
      }
      labelParts.push(name);
      return labelParts.join(' ');
    });
    const baselineLabels = [
      `${formatModeLabel('extracted-prose')} Artifacts`,
      `${formatModeLabel('extracted-prose')} Files`,
      `${formatModeLabel('extracted-prose')} Stage`,
      `${formatModeLabel('extracted-prose')} Imports`,
      `${formatModeLabel('extracted-prose')} Shard`,
      `${formatModeLabel('records')} Files`,
      'bench Repos',
      'queries Queries'
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
    const now = Date.now();
    const taskColors = new Map();
    const taskAccents = new Map();
    const taskShades = new Map();
    const schemes = [
      { name: 'forward', stepFactor: 0.8, mode: 'linear', direction: 1 },
      { name: 'reverse', stepFactor: 0.8, mode: 'linear', direction: -1 },
      { name: 'drift', stepFactor: 0.6, mode: 'linear', direction: 1 },
      { name: 'pulse', stepFactor: 0.7, mode: 'triangle', span: Math.min(8, PALETTE.length - 1) }
    ];
    if (!state.paletteScheme) {
      state.paletteScheme = schemes[Math.floor(Math.random() * schemes.length)];
    }
    const paletteSpan = Math.max(1, displayTasks.length - 1);
    if (!Number.isFinite(state.paletteStep)) {
      const baseStep = Math.min(0.9, (PALETTE.length - 1) / paletteSpan);
      state.paletteStep = baseStep * (state.paletteScheme.stepFactor || 1);
    }
    const paletteStep = state.paletteStep || 0.7;
    const maxOffset = Math.max(0, (PALETTE.length - 1) - paletteStep * paletteSpan);
    if (!Number.isFinite(state.paletteOffset)) {
      state.paletteOffset = maxOffset > 0 ? Math.random() * maxOffset : 0;
    } else if (state.paletteOffset > maxOffset) {
      state.paletteOffset = maxOffset;
    }
    const paletteOffset = state.paletteOffset || 0;
    const normalizeSlot = (slot) => {
      const span = PALETTE.length - 1;
      if (span <= 0) return 0;
      const wrapped = ((slot % span) + span) % span;
      return wrapped;
    };
    const resolveSlotForIndex = (index) => {
      const scheme = state.paletteScheme || schemes[0];
      if (scheme.mode === 'triangle') {
        const span = Math.max(2, scheme.span || 6);
        const period = (span - 1) * 2;
        const pos = period > 0 ? index % period : 0;
        const wave = pos < span ? pos : period - pos;
        return normalizeSlot(paletteOffset + wave * paletteStep);
      }
      const direction = scheme.direction || 1;
      return normalizeSlot(paletteOffset + direction * index * paletteStep);
    };
    for (const task of displayTasks) {
      if (!state.paletteSlots.has(task.id)) {
        const index = state.paletteOrder.length;
        const slot = resolveSlotForIndex(index);
        state.paletteSlots.set(task.id, slot);
        state.paletteOrder.push(task.id);
      }
    }
    displayTasks.forEach((task) => {
      const slot = state.paletteSlots.get(task.id) ?? paletteOffset;
      const baseRaw = paletteColorAt(slot);
      const base = clampBackgroundColor(baseRaw);
      const accent = paletteColorAt(Math.min(PALETTE.length - 1, slot + 0.9));
      taskColors.set(task.id, base);
      taskAccents.set(task.id, accent);
      taskShades.set(task.id, buildShadeScale(base));
    });
    const resolveBackgroundColor = (task, variant) => {
      if (!task?.mode) return null;
      if (variant === 'imports') {
        const stageTask = tasksByMode.stage.get(task.mode);
        if (stageTask) {
          const base = taskColors.get(stageTask.id) || null;
          return base ? scaleColor(base, 0.22) : null;
        }
      }
      if (variant === 'files') {
        const importsTask = tasksByMode.imports.get(task.mode);
        if (importsTask) {
          const base = taskColors.get(importsTask.id) || null;
          return base ? scaleColor(base, 0.22) : null;
        }
      }
      return null;
    };
    const suffixes = displayTasks.map((task) => {
      const total = Number.isFinite(task.total) && task.total > 0 ? task.total : null;
      const current = Number.isFinite(task.current) ? task.current : 0;
      return total ? `${formatCount(current)}/${formatCount(total)}` : formatCount(current);
    });
    const maxSuffixLength = suffixes.reduce((max, value) => Math.max(max, stripAnsi(value).length), 0);
    const padSuffix = (value) => {
      const plainLength = stripAnsi(value).length;
      if (plainLength >= maxSuffixLength) return value;
      return `${value}${' '.repeat(maxSuffixLength - plainLength)}`;
    };
    const extrasByTask = displayTasks.map((task) => buildProgressExtras(task, now));
    const benchPrefixes = displayTasks.map((task, index) => {
      if (String(task?.stage || '').toLowerCase() !== 'bench') return '';
      const elapsedSec = extrasByTask[index]?.elapsedSec;
      if (!Number.isFinite(elapsedSec) || elapsedSec <= 0) return '';
      const parts = splitDurationParts(elapsedSec);
      return `⌛ ${formatDurationCompact(parts)}`;
    });
    const maxBenchPrefixLength = benchPrefixes.reduce(
      (max, value) => Math.max(max, stripAnsi(value || '').length),
      0
    );
    const padBenchPrefix = (value) => {
      if (!maxBenchPrefixLength) return value || '';
      return padVisible(value || '', maxBenchPrefixLength);
    };
    const rateTexts = extrasByTask.map((entry) => entry?.rateText || '');
    const maxRateLength = rateTexts.reduce((max, value) => Math.max(max, stripAnsi(value).length), 0);
    const padRate = (value) => {
      const plainLength = stripAnsi(value).length;
      if (plainLength >= maxRateLength) return value;
      return `${value}${' '.repeat(maxRateLength - plainLength)}`;
    };
    const formatMessage = (value) => {
      if (!value) return '';
      const text = String(value);
      if (text.includes('/') || text.includes('\\') || text.includes('.')) return text;
      return text
        .split(/\s+/)
        .map((part) => {
          if (!part) return '';
          const upper = part.toUpperCase();
          if (part === upper) return part;
          return `${part[0]?.toUpperCase() || ''}${part.slice(1)}`;
        })
        .join(' ')
        .trim();
    };
    const timeValues = displayTasks.map((task, index) => {
      const extras = extrasByTask[index];
      if (!extras) return null;
      const value = task.status === 'running' ? extras.etaSec : extras.elapsedSec;
      return Number.isFinite(value) ? value : null;
    });
    const timeParts = timeValues.map((value) => (Number.isFinite(value) ? splitDurationParts(value) : null));
    const useAlignedUnits = timeParts.some((parts) => parts && (parts.days > 0 || parts.hours > 0));
    const layoutWidths = { days: 0, hours: 0, minutes: 0, seconds: 0, widths: [] };
    if (useAlignedUnits) {
      layoutWidths.days = Math.max(...timeParts.map((parts) => parts && parts.days > 0 ? `${parts.days}d`.length : 0), 0);
      layoutWidths.hours = Math.max(...timeParts.map((parts) => parts && parts.hours > 0 ? `${parts.hours}h`.length : 0), 0);
      layoutWidths.minutes = Math.max(...timeParts.map((parts) => {
        if (!parts) return 0;
        if (parts.minutes > 0) return `${parts.minutes}m`.length;
        if (parts.hours > 0 && parts.seconds > 0) return '0m'.length;
        return 0;
      }), 0);
      layoutWidths.seconds = Math.max(...timeParts.map((parts) => {
        if (!parts) return 0;
        if (parts.ms) return `${parts.ms}ms`.length;
        if (parts.seconds > 0) return `${parts.seconds}s`.length;
        return 0;
      }), 0);
      layoutWidths.widths = [layoutWidths.days, layoutWidths.hours, layoutWidths.minutes, layoutWidths.seconds];
    }
    const formatTimeText = (task, value, parts) => {
      if (!Number.isFinite(value) || !parts) return '';
      if (task.status === 'running') {
        return useAlignedUnits
          ? formatDurationAligned(parts, layoutWidths)
          : formatDurationEtaCompact(parts);
      }
      return useAlignedUnits
        ? formatDurationAligned(parts, layoutWidths)
        : formatDurationCompact(parts);
    };
    const detailTexts = displayTasks.map((task, index) => {
      const value = timeValues[index];
      const parts = timeParts[index];
      return formatTimeText(task, value, parts);
    });
    const detailMaxRaw = detailTexts.reduce((max, value) => Math.max(max, stripAnsi(value).length), 0);
    const detailPrefix = 'eta:';
    const detailWidth = detailMaxRaw + detailPrefix.length + 1;
    const padDetail = (task, value) => {
      if (!value) return padVisibleStart('', detailWidth);
      if (task.status === 'running') {
        const padded = padVisibleStart(value, detailMaxRaw);
        return `${detailPrefix} ${padded}`;
      }
      return padVisibleStart(value, detailWidth);
    };
    const messageTexts = displayTasks.map((task) => {
      if (task?.status !== 'running') return '';
      return formatMessage(task.message);
    });
    const maxMessageLength = messageTexts.reduce((max, value) => Math.max(max, stripAnsi(value).length), 0);
    const padMessage = (value) => padVisible(value || '', maxMessageLength);
    const buildStatusDone = () => {
      if (!colorEnabled) return '[✓]';
      const fg = colorToAnsi(CHECK_FG_OK);
      const bgBracket = colorToAnsi(BLACK, true);
      const left = `\x1b[${composeColor(fg, bgBracket)}m[\x1b[0m`;
      const check = `\x1b[${composeColor(fg, bgBracket)}m✓\x1b[0m`;
      const right = `\x1b[${composeColor(fg, bgBracket)}m]\x1b[0m`;
      return `${left}${check}${right}`;
    };
    const buildStatusFail = () => {
      if (!colorEnabled) return '[!]';
      const fg = colorToAnsi(CHECK_FG_FAIL);
      const bgBracket = colorToAnsi(BLACK, true);
      const left = `\x1b[${composeColor(fg, bgBracket)}m[\x1b[0m`;
      const check = `\x1b[${composeColor(fg, bgBracket)}m!\x1b[0m`;
      const right = `\x1b[${composeColor(fg, bgBracket)}m]\x1b[0m`;
      return `${left}${check}${right}`;
    };
    const statusDone = buildStatusDone();
    const statusWidth = Math.max(
      3,
      displayTasks.reduce((max, task) => {
        if (!task?.status || task.status === 'running') return max;
        const text = task.status === 'done'
          ? statusDone
          : task.status === 'failed'
            ? buildStatusFail()
            : `(${task.status})`;
        return Math.max(max, stripAnsi(text).length);
      }, 0)
    );
    const BAR_MAX = 42;
    const BAR_MID = 21;
    const BAR_MIN = 7;
    const tryLayout = ({ showSuffix, showRate, showDetail, showMessage, showTimePrefix, minBar }) => {
      const suffixLen = showSuffix ? maxSuffixLength : 0;
      const rateLen = showRate ? maxRateLength : 0;
      const detailLen = showDetail ? detailWidth : 0;
      const messageLen = showMessage ? maxMessageLength : 0;
      const timePrefixLen = showTimePrefix ? Math.max(0, maxBenchPrefixLength) : 0;
      let extraLen = 0;
      if (showRate && showDetail && showMessage) extraLen = 3 + rateLen + 3 + detailLen + 3 + messageLen;
      else if (showRate && showDetail) extraLen = 3 + rateLen + 3 + detailLen;
      else if (showRate) extraLen = 3 + rateLen;
      else if (showDetail) extraLen = 3 + detailLen;
      const reserved = labelWidth + 1 + (timePrefixLen ? timePrefixLen + 1 : 0) + 2 + 1 + suffixLen + 1 + statusWidth + extraLen;
      const available = width - reserved;
      if (available < minBar) return null;
      const barWidth = Math.min(BAR_MAX, Math.max(minBar, available));
      return { showSuffix, showRate, showDetail, showMessage, showTimePrefix, barWidth };
    };
    const showTimePrefix = maxBenchPrefixLength > 0;
    const layout = tryLayout({
      showSuffix: true,
      showRate: true,
      showDetail: true,
      showMessage: maxMessageLength > 0,
      showTimePrefix,
      minBar: BAR_MID
    })
      || tryLayout({
        showSuffix: false,
        showRate: true,
        showDetail: true,
        showMessage: maxMessageLength > 0,
        showTimePrefix,
        minBar: BAR_MID
      })
      || tryLayout({
        showSuffix: false,
        showRate: false,
        showDetail: true,
        showMessage: maxMessageLength > 0,
        showTimePrefix,
        minBar: Math.floor(BAR_MID * 2 / 3)
      })
      || tryLayout({
        showSuffix: false,
        showRate: false,
        showDetail: false,
        showMessage: false,
        showTimePrefix,
        minBar: BAR_MIN
      })
      || {
        showSuffix: false,
        showRate: false,
        showDetail: false,
        showMessage: false,
        showTimePrefix,
        barWidth: BAR_MIN
      };
    const hueShiftVariants = new Set(['files', 'imports', 'artifacts', 'records', 'embeddings', 'shard']);
    const taskLines = displayTasks.map((task, index) => {
      const total = Number.isFinite(task.total) && task.total > 0 ? task.total : null;
      const current = Number.isFinite(task.current) ? task.current : 0;
      let pct = total ? current / total : 0;
      if (overallOverride !== null && task === overallTask) {
        pct = overallOverride;
      }
      const suffix = layout.showSuffix ? padSuffix(suffixes[index] || formatCount(current)) : '';
      const barWidth = layout.barWidth;
      const colorize = colorEnabled
        ? (text, code) => (text && code ? `\x1b[${code}m${text}\x1b[0m` : text || '')
        : null;
      const tintText = (text, background = null) => {
        if (!colorEnabled || !text) return text || '';
        if (text.includes('\x1b')) return text;
        const fg = colorToAnsi(OFF_WHITE);
        const bg = background ? colorToAnsi(background, true) : null;
        return colorize(text, composeColor(fg, bg));
      };
      const variant = resolveBarVariant(task);
      const style = BAR_STYLES[variant] || BAR_STYLES.default;
      const baseColor = taskColors.get(task.id)
        || resolveGradientColor(index, orderedTasks.length, paletteOffset, paletteStep);
      const accentColor = taskAccents.get(task.id) || baseColor;
      const shades = taskShades.get(task.id) || buildShadeScale(baseColor);
      const shadeAt = (shadeIndex) => shades[Math.max(0, Math.min(25, shadeIndex))] || baseColor;
      const shadeBar = shadeAt(3);
      const fillColor = lightenColor(baseColor, 0.12);
      const edgeColor = lightenColor(baseColor, 0.25);
      const emptyColor = scaleColor(baseColor, 0.18);
      const fill = colorToAnsi(fillColor);
      const edge = colorToAnsi(edgeColor);
      const empty = colorToAnsi(emptyColor);
      const backgroundColor = resolveBackgroundColor(task, variant) || shadeBar;
      const background = colorToAnsi(backgroundColor, true);
      const bracketFg = colorToAnsi(OFF_WHITE);
      const extras = extrasByTask[index];
      const rawRate = Number(extras?.rawRate) || 0;
      const speedNormalized = Math.min(1, Math.log10(rawRate + 1) / 2);
      const bracketMinIndex = 6;
      const bracketIndex = Math.round(25 - (25 - bracketMinIndex) * speedNormalized);
      const bracketBg = colorToAnsi(shadeAt(bracketIndex), true);
      const theme = {
        fill,
        edge,
        empty,
        bracketFg,
        bracketBg,
        background
      };
      if (variant === 'files') {
        theme.edge = fill;
      }
      const animateEdge = task.status === 'running' && variant === 'stage' && current > 0;
      const animateIndex = animateEdge ? Math.floor(now / 320) : null;
      const fillGradient = hueShiftVariants.has(variant)
        ? (pos, count) => mixColor(baseColor, accentColor, count > 1 ? pos / (count - 1) : 0)
        : null;
      const bar = buildBar(clampRatio(pct), barWidth, style, theme, colorize, {
        animateIndex,
        fillGradient
      });
      const shadeLabel = shadeAt(0);
      const shadeTime = shadeAt(1);
      const shadeSuffix = shadeAt(2);
      const shadeRate = shadeAt(4);
      const shadeMessage = shadeAt(5);

      const label = tintText(padLabel(taskLabels[index] || task.name, labelWidth), shadeLabel);
      const timePrefix = layout.showTimePrefix ? tintText(padBenchPrefix(benchPrefixes[index]), shadeTime) : '';
      const timeText = timePrefix ? `${timePrefix}` : '';
      let status = '';
      if (task.status && task.status !== 'running') {
        status = task.status === 'done'
          ? statusDone
          : task.status === 'failed'
            ? buildStatusFail()
            : `(${task.status})`;
      }
      status = ` ${tintText(padVisible(status, statusWidth), shadeSuffix)}`;
      let detail = layout.showDetail ? padDetail(task, detailTexts[index] || '') : '';
      if (detail && colorEnabled && task.status === 'running') {
        const fg = colorToAnsi(OFF_WHITE);
        const progress = total ? clampRatio(current / total) : 0;
        const etaStartIndex = 10;
        const etaIndex = Math.round(etaStartIndex + (25 - etaStartIndex) * progress);
        const etaBg = colorToAnsi(shadeAt(etaIndex), true);
        detail = `\x1b[${composeColor(fg, etaBg)}m${detail}\x1b[0m`;
      }
      if (detail) detail = tintText(detail, shadeRate);
      const message = layout.showMessage ? tintText(padMessage(messageTexts[index] || ''), shadeMessage) : '';
      const rate = layout.showRate ? tintText(padRate(extras?.rateText || ''), shadeRate) : '';
      const separator = colorEnabled
        ? `\x1b[${composeColor(colorToAnsi(accentColor), colorToAnsi(BLACK, true))}m | \x1b[0m`
        : ' | ';
      const parts = [];
      if (layout.showRate) parts.push(rate);
      if (layout.showDetail) parts.push(detail);
      if (layout.showMessage) parts.push(message);
      const extraText = parts.length ? `${separator}${parts.join(separator)}`.trimEnd() : '';
      const suffixText = suffix ? ` ${tintText(suffix, shadeSuffix)}` : '';
      return `${label} ${timeText}${bar}${suffixText}${status}${extraText}`.trimEnd();
    });

    const statusLine = state.statusLine;
    const logSlots = Math.max(0, logWindowSize - (statusLine ? 1 : 0));
    const logLines = state.logLines.slice(-logSlots);
    while (logLines.length < logSlots) logLines.push('');
    if (statusLine) logLines.push(statusLine);
    const lines = [...logLines, '', ...taskLines, ''];
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

  const updateTask = (task, update = {}) => {
    if (Number.isFinite(update.current)) task.current = update.current;
    if (Number.isFinite(update.total)) task.total = update.total;
    if (typeof update.name === 'string' && update.name.trim()) task.name = update.name;
    if (typeof update.status === 'string') task.status = update.status;
    if (typeof update.message === 'string') task.message = update.message;
    if (typeof update.stage === 'string') task.stage = update.stage;
    if (typeof update.mode === 'string') task.mode = update.mode;
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
    flush,
    close
  };
}
