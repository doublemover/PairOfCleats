import { writeProgressEvent } from './progress-events.js';
import { normalizeProgressMode, resolveTerminal, resolveWidth } from './display/terminal.js';
import { BAR_STYLES, buildBar } from './display/bar.js';
import {
  BLACK,
  STATUS_BRACKET_FG,
  CHECK_FG_OK,
  CHECK_FG_FAIL,
  PALETTE,
  clampBackgroundColor,
  makeTextForeground,
  makeBarForeground,
  buildShadeScale,
  shiftHue,
  hashUnit,
  extractExtension,
  colorToAnsi,
  composeColor,
  mixColor,
  scaleColor,
  resolveGradientColor,
  paletteColorAt
} from './display/colors.js';
import {
  stripAnsi,
  formatCount,
  padLabel,
  padVisible,
  padVisibleStart,
  truncateLine,
  resolveRateUnit,
  formatRate,
  titleCaseUnit,
  formatSecondsPerUnit,
  splitDurationParts,
  formatDurationCompact,
  formatDurationEtaCompact,
  formatDurationAligned
} from './display/text.js';
const LINE_PREFIX_TRANSPARENT = ' ';
const LINE_PREFIX_SHADED = ' ';

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

// Helpers moved to ./display modules.

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
    paletteOrder: [],
    rateMaxByTask: new Map(),
    hueShiftByTask: new Map()
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
    const now = Date.now();
    const extrasByTask = displayTasks.map((task) => buildProgressExtras(task, now));
    const benchPrefixes = displayTasks.map((task, index) => {
      if (String(task?.stage || '').toLowerCase() !== 'bench') return '';
      const elapsedSec = extrasByTask[index]?.elapsedSec;
      if (!Number.isFinite(elapsedSec) || elapsedSec <= 0) return '';
      const parts = splitDurationParts(elapsedSec);
      return `t:${formatDurationCompact(parts)}`;
    });
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
    // extrasByTask and benchPrefixes are computed earlier to size labels.
    const baseLabelLength = [...taskLabels, ...baselineLabels]
      .reduce((max, label) => Math.max(max, stripAnsi(label).length), 0);
    const benchLabelLength = taskLabels.reduce((max, label, index) => {
      const prefix = benchPrefixes[index] || '';
      if (!prefix) return max;
      const length = stripAnsi(label).length + 1 + stripAnsi(prefix).length;
      return Math.max(max, length);
    }, 0);
    const maxLabelLength = Math.max(baseLabelLength, benchLabelLength);
    const labelWidth = Math.min(maxLabelLength, Math.max(12, Math.floor(width * 0.32)));
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
    const taskColors = new Map();
    const taskAccents = new Map();
    const taskShades = new Map();
    const schemes = [
      { name: 'forward', stepFactor: 0.9, mode: 'linear', direction: 1 },
      { name: 'reverse', stepFactor: 0.9, mode: 'linear', direction: -1 },
      { name: 'drift', stepFactor: 1.05, mode: 'linear', direction: 1 },
      { name: 'pulse', stepFactor: 0.95, mode: 'triangle', span: Math.min(10, PALETTE.length - 1) }
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
    const resolveHueShiftForTask = (task, variant) => {
      const extra = task?.extra && typeof task.extra === 'object' ? task.extra : {};
      const langHint = extra.languageId || extra.language || extra.lang || extra.extension || '';
      const messageExt = extractExtension(task?.message || '');
      const typeHint = langHint || messageExt;
      const key = `${task?.mode || ''}:${variant || ''}:${typeHint || ''}:${task?.name || ''}`;
      if (!state.hueShiftByTask.has(key)) {
        const unit = hashUnit(key);
        state.hueShiftByTask.set(key, (unit - 0.5) * 30);
      }
      return state.hueShiftByTask.get(key) || 0;
    };
    displayTasks.forEach((task) => {
      const slot = state.paletteSlots.get(task.id) ?? paletteOffset;
      const baseRaw = paletteColorAt(slot);
      const accentRaw = paletteColorAt(Math.min(PALETTE.length - 1, slot + 0.9));
      const variant = resolveBarVariant(task);
      const hueShift = resolveHueShiftForTask(task, variant);
      const base = clampBackgroundColor(shiftHue(baseRaw, hueShift), 0.5);
      const accent = clampBackgroundColor(shiftHue(accentRaw, hueShift), 0.5);
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
          return base ? scaleColor(base, 0.28) : null;
        }
      }
      if (variant === 'files') {
        const importsTask = tasksByMode.imports.get(task.mode);
        if (importsTask) {
          const base = taskColors.get(importsTask.id) || null;
          return base ? scaleColor(base, 0.28) : null;
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
    // extrasByTask and benchPrefixes already computed above.
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
      const bracketFg = colorToAnsi(STATUS_BRACKET_FG);
      const checkFg = colorToAnsi(CHECK_FG_OK);
      const bgBracket = colorToAnsi(BLACK, true);
      const bracketCode = composeColor(bracketFg, bgBracket);
      const bracketBold = `1;${bracketCode}`;
      const left = `\x1b[${bracketBold}m[\x1b[0m`;
      const check = `\x1b[${composeColor(checkFg, bgBracket)}m✓\x1b[0m`;
      const right = `\x1b[${bracketBold}m]\x1b[0m`;
      return `${left}${check}${right}`;
    };
    const buildStatusFail = () => {
      if (!colorEnabled) return '[!]';
      const bracketFg = colorToAnsi(STATUS_BRACKET_FG);
      const checkFg = colorToAnsi(CHECK_FG_FAIL);
      const bgBracket = colorToAnsi(BLACK, true);
      const bracketCode = composeColor(bracketFg, bgBracket);
      const bracketBold = `1;${bracketCode}`;
      const left = `\x1b[${bracketBold}m[\x1b[0m`;
      const check = `\x1b[${composeColor(checkFg, bgBracket)}m!\x1b[0m`;
      const right = `\x1b[${bracketBold}m]\x1b[0m`;
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
    const indentWidth = stripAnsi(`${LINE_PREFIX_TRANSPARENT}${LINE_PREFIX_SHADED}`).length;
    const BAR_MAX = 42;
    const BAR_MID = 21;
    const BAR_MIN = 7;
    const tryLayout = ({ showSuffix, showRate, showDetail, showMessage, minBar }) => {
      const suffixLen = showSuffix ? maxSuffixLength : 0;
      const rateLen = showRate ? maxRateLength : 0;
      const detailLen = showDetail ? detailWidth : 0;
      const messageLen = showMessage ? maxMessageLength : 0;
      const timePrefixLen = 0;
      let extraLen = 0;
      if (showRate && showDetail && showMessage) extraLen = 3 + rateLen + 3 + detailLen + 3 + messageLen;
      else if (showRate && showDetail) extraLen = 3 + rateLen + 3 + detailLen;
      else if (showRate) extraLen = 3 + rateLen;
      else if (showDetail) extraLen = 3 + detailLen;
      const barGuardWidth = 0;
      const reserved = indentWidth + labelWidth + (timePrefixLen ? timePrefixLen + 1 : 0) + barGuardWidth + 2 + 1 + suffixLen + 1 + statusWidth + extraLen;
      const available = width - reserved;
      if (available < minBar) return null;
      const barWidth = Math.min(BAR_MAX, Math.max(minBar, available));
      return { showSuffix, showRate, showDetail, showMessage, barWidth };
    };
    const layout = tryLayout({
      showSuffix: true,
      showRate: true,
      showDetail: true,
      showMessage: maxMessageLength > 0,
      minBar: BAR_MID
    })
      || tryLayout({
        showSuffix: false,
        showRate: true,
        showDetail: true,
        showMessage: maxMessageLength > 0,
        minBar: BAR_MID
      })
      || tryLayout({
        showSuffix: false,
        showRate: false,
        showDetail: true,
        showMessage: maxMessageLength > 0,
        minBar: Math.floor(BAR_MID * 2 / 3)
      })
      || tryLayout({
        showSuffix: false,
        showRate: false,
        showDetail: false,
        showMessage: false,
        minBar: BAR_MIN
      })
      || {
        showSuffix: false,
        showRate: false,
        showDetail: false,
        showMessage: false,
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
      const variant = resolveBarVariant(task);
      const style = BAR_STYLES[variant] || BAR_STYLES.default;
      const baseColor = taskColors.get(task.id)
        || resolveGradientColor(index, orderedTasks.length, paletteOffset, paletteStep);
      const accentColor = taskAccents.get(task.id) || baseColor;
      const foregroundColor = makeTextForeground(baseColor, 0.6);
      const accentForeground = makeTextForeground(accentColor, 0.55);
      const tintText = (text, background = null, foreground = foregroundColor) => {
        if (!colorEnabled || !text) return text || '';
        if (text.includes('\x1b')) return text;
        const fg = colorToAnsi(foreground);
        const bg = background ? colorToAnsi(background, true) : null;
        return colorize(text, composeColor(fg, bg));
      };
      const shades = taskShades.get(task.id) || buildShadeScale(baseColor);
      const shadeAt = (shadeIndex) => shades[Math.max(0, Math.min(25, shadeIndex))] || baseColor;
      const shadeBar = shadeAt(3);
      const backgroundColor = clampBackgroundColor(resolveBackgroundColor(task, variant) || shadeBar, 0.5);
      const barForeground = makeBarForeground(backgroundColor, 0.4);
      const barEdge = makeBarForeground(backgroundColor, 0.55);
      const barEmpty = scaleColor(barForeground, 0.45);
      const fill = colorToAnsi(barForeground);
      const edge = colorToAnsi(barEdge);
      const empty = colorToAnsi(barEmpty);
      const background = colorToAnsi(backgroundColor, true);
      const extras = extrasByTask[index];
      const rawRate = Number(extras?.rawRate) || 0;
      let rateMax = state.rateMaxByTask.get(task.id) || 0;
      if (rawRate > rateMax) {
        rateMax = rawRate;
        state.rateMaxByTask.set(task.id, rateMax);
      }
      const speedNormalized = rateMax > 0 ? Math.min(1, rawRate / rateMax) : 0;
      const waveSpeed = 0.25 + speedNormalized * 1.35;
      const wavePhase = (now / 1000) * waveSpeed * Math.PI * 2;
      const wave = (Math.sin(wavePhase) + 1) / 2;
      const baseIndex = Math.round(6 + speedNormalized * 8);
      const waveSpan = 5 + Math.round(speedNormalized * 6);
      const bracketIndex = Math.round(Math.max(0, Math.min(25, baseIndex + (wave - 0.5) * waveSpan)));
      const bracketShade = shadeAt(bracketIndex);
      const bracketBg = '';
      const bracketFg = colorToAnsi(makeTextForeground(bracketShade, 0.6));
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
        ? (pos, count) => {
          const from = makeBarForeground(backgroundColor, 0.38);
          const to = makeBarForeground(clampBackgroundColor(accentColor, 0.5), 0.45);
          return mixColor(from, to, count > 1 ? pos / (count - 1) : 0);
        }
        : null;
      const shadeLabel = shadeAt(0);
      const shadeTime = shadeAt(1);
      const shadeSuffix = shadeAt(2);
      const shadeRate = shadeAt(4);
      const shadeMessage = shadeAt(5);

      const labelFg = makeTextForeground(shadeLabel, 0.6);
      const timeFg = makeTextForeground(shadeTime, 0.6);
      const suffixFg = makeTextForeground(shadeSuffix, 0.55);
      const rateFg = makeTextForeground(shadeRate, 0.55);
      const messageFg = makeTextForeground(shadeMessage, 0.55);
      const bar = buildBar(clampRatio(pct), barWidth, style, theme, colorize, {
        animateIndex,
        fillGradient
      });
      const progress = total ? clampRatio(current / total) : 0;

      const indent = `${LINE_PREFIX_TRANSPARENT}${tintText(LINE_PREFIX_SHADED, shadeAt(3), labelFg)}`;
      const timeText = benchPrefixes[index] || '';
      const barPrefix = '';
      const barSuffix = '';
      let label;
      if (timeText) {
        const timeLen = stripAnsi(timeText).length;
        if (labelWidth > timeLen) {
          const labelSpace = Math.max(1, labelWidth - timeLen);
          const baseLabel = padLabel(taskLabels[index] || task.name, labelSpace);
          const labelPart = tintText(baseLabel, shadeLabel, labelFg);
          const timePart = tintText(timeText, shadeTime, timeFg);
          label = `${labelPart}${timePart}`;
        } else {
          label = tintText(
            padLabel(`${taskLabels[index] || task.name}${timeText}`, labelWidth),
            shadeLabel,
            labelFg
          );
        }
      } else {
        label = tintText(padLabel(taskLabels[index] || task.name, labelWidth), shadeLabel, labelFg);
      }
      let status = '';
      if (task.status && task.status !== 'running') {
        status = task.status === 'done'
          ? statusDone
          : task.status === 'failed'
            ? buildStatusFail()
            : `(${task.status})`;
      }
      {
        const statusBody = padVisible(status, statusWidth);
        const statusPrefix = tintText(' ', shadeSuffix, suffixFg);
        const statusTint = tintText(statusBody, shadeSuffix, suffixFg);
        status = `${statusPrefix}${statusTint}`;
      }
      let detail = layout.showDetail ? padDetail(task, detailTexts[index] || '') : '';
      if (detail && colorEnabled && task.status === 'running') {
        const fg = colorToAnsi(rateFg);
        const etaStartIndex = 10;
        const etaIndex = Math.round(etaStartIndex + (25 - etaStartIndex) * progress);
        const etaBg = colorToAnsi(shadeAt(etaIndex), true);
        detail = `\x1b[${composeColor(fg, etaBg)}m${detail}\x1b[0m`;
      }
      if (detail) detail = tintText(detail, shadeRate, rateFg);
      const message = layout.showMessage ? tintText(padMessage(messageTexts[index] || ''), shadeMessage, messageFg) : '';
      const rate = layout.showRate ? tintText(padRate(extras?.rateText || ''), shadeRate, rateFg) : '';
      const separator = colorEnabled
        ? `\x1b[${composeColor(colorToAnsi(accentForeground), colorToAnsi(BLACK, true))}m | \x1b[0m`
        : ' | ';
      const parts = [];
      if (layout.showRate) parts.push(rate);
      if (layout.showDetail) parts.push(detail);
      if (layout.showMessage) parts.push(message);
      const extraText = parts.length ? `${separator}${parts.join(separator)}`.trimEnd() : '';
      const suffixPad = tintText(' ', shadeAt(Math.round(progress * 18)), labelFg);
      const suffixText = suffix ? `${suffixPad}${tintText(suffix, shadeSuffix, suffixFg)}` : suffixPad;
      return `${indent}${label}${barPrefix}${bar}${barSuffix}${suffixText}${status}${extraText}`.trimEnd();
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
