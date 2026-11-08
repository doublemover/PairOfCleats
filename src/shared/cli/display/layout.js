import { buildProgressExtras, LINE_PREFIX_SHADED, LINE_PREFIX_TRANSPARENT } from './progress.js';
import {
  formatCount,
  formatDurationAligned,
  formatDurationCompact,
  formatDurationEtaCompact,
  padVisible,
  padVisibleStart,
  splitDurationParts,
  displayWidth,
  truncateLine
} from './text.js';

const BAR_MIN = 7;

/** All widths are display cells. Separators and bar brackets are reserved once. */
export const resolveRowCellBudget = ({ width, fixed, suffix = 0, rate = 0, detail = 0, message = 0, policy = 'normal' }) => {
  const available = Math.max(0, width - fixed - suffix);
  if (available < 4) return { compact: true, showSuffix: true, showRate: false, showDetail: false, showMessage: false,
    fields: { rate: 0, detail: 0, message: 0 }, omittedFields: ['bar', ...Object.entries({ rate, detail, message }).filter(([, size]) => size > 0).map(([name]) => name)], barWidth: 0 };
  let remaining = Math.max(0, available - BAR_MIN);
  const fields = { rate: 0, detail: 0, message: 0 };
  for (const [name, size] of [['rate', rate], ['detail', policy === 'compact' ? 0 : detail], ['message', message]]) {
    if (size > 0 && remaining >= size + 3) { fields[name] = size; remaining -= size + 3; }
  }
  const omittedFields = Object.entries({ rate, detail, message }).filter(([name, size]) => size > 0 && !fields[name]).map(([name]) => name);
  return { showSuffix: true, showRate: fields.rate > 0, showDetail: fields.detail > 0,
    showMessage: fields.message > 0, fields, omittedFields,
    barWidth: Math.max(4, available - Object.values(fields).reduce((sum, size) => sum + (size ? size + 3 : 0), 0)) };
};

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

export const formatModeLabel = (mode) => {
  if (!mode) return '';
  return String(mode)
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() || ''}${part.slice(1)}`)
    .join(' ');
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

export const resolveOrderedDisplayTasks = (state) => {
  const tasks = state.taskOrder.map((id, order) => ({ task: state.tasks.get(id), order }))
    .filter((entry) => entry.task);
  tasks.sort((a, b) => b.order - a.order);
  const orderedTasks = tasks.map((entry) => entry.task);
  return {
    orderedTasks,
    displayTasks: orderedTasks.filter((task) => !shouldHideTask(task))
  };
};

export const groupDisplayTasksByMode = (orderedTasks) => {
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
  return { tasksByMode, overallTask };
};

const buildTaskLabels = (displayTasks) => displayTasks.map((task) => {
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

const resolveLabelWidth = ({ taskLabels, benchPrefixes, width }) => {
  const baseLabelLength = taskLabels.reduce((max, label) => Math.max(max, displayWidth(label)), 0);
  const benchLabelLength = taskLabels.reduce((max, label, index) => {
    const prefix = benchPrefixes[index] || '';
    if (!prefix) return max;
    const length = displayWidth(label) + 1 + displayWidth(prefix);
    return Math.max(max, length);
  }, 0);
  const maxLabelLength = Math.max(baseLabelLength, benchLabelLength);
  return Math.min(maxLabelLength, Math.max(3, Math.floor(width * 0.28)));
};

const buildTimeLayout = ({ displayTasks, extrasByTask }) => {
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
  return { timeValues, timeParts, useAlignedUnits, layoutWidths };
};

const formatTimeText = ({ task, value, parts, useAlignedUnits, layoutWidths }) => {
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

export const resolveDisplayLayout = ({ displayTasks, width, statusDone, statusFail, detailPolicy = 'normal' }) => {
  const now = Date.now();
  const runningNow = Math.floor(now / 1000) * 1000;
  const extrasByTask = displayTasks.map((task) => {
    const snapshotNow = task?.status === 'running'
      ? runningNow
      : (Number.isFinite(task?.lastUpdateMs)
        ? Math.max(0, Number(task.lastUpdateMs))
        : now);
    return buildProgressExtras(task, snapshotNow);
  });
  const benchPrefixes = displayTasks.map((task, index) => {
    if (String(task?.stage || '').toLowerCase() !== 'bench') return '';
    const elapsedSec = extrasByTask[index]?.elapsedSec;
    if (!Number.isFinite(elapsedSec) || elapsedSec <= 0) return '';
    const parts = splitDurationParts(elapsedSec);
    return `t:${formatDurationCompact(parts)}`;
  });
  const taskLabels = buildTaskLabels(displayTasks);
  const labelWidth = resolveLabelWidth({ taskLabels, benchPrefixes, width });
  const suffixes = displayTasks.map((task) => {
    const total = Number.isFinite(task.total) && task.total > 0 ? task.total : null;
    const current = Number.isFinite(task.current) ? task.current : 0;
    return total ? `${formatCount(current)}/${formatCount(total)}` : formatCount(current);
  });
  const maxSuffixLength = suffixes.reduce((max, value) => Math.max(max, displayWidth(value)), 0);
  const padSuffix = (value) => {
    const plainLength = displayWidth(value);
    if (plainLength >= maxSuffixLength) return value;
    return `${value}${' '.repeat(maxSuffixLength - plainLength)}`;
  };
  const rateTexts = extrasByTask.map((entry) => entry?.rateText || '');
  const maxRateLength = rateTexts.reduce((max, value) => Math.max(max, displayWidth(value)), 0);
  const padRate = (value) => {
    const plainLength = displayWidth(value);
    if (plainLength >= maxRateLength) return value;
    return `${value}${' '.repeat(maxRateLength - plainLength)}`;
  };
  const { timeValues, timeParts, useAlignedUnits, layoutWidths } = buildTimeLayout({ displayTasks, extrasByTask });
  const detailTexts = displayTasks.map((task, index) => formatTimeText({
    task,
    value: timeValues[index],
    parts: timeParts[index],
    useAlignedUnits,
    layoutWidths
  }));
  const detailMaxRaw = detailTexts.reduce((max, value) => Math.max(max, displayWidth(value)), 0);
  const detailPrefix = 'eta:';
  const detailWidth = detailMaxRaw > 0 ? detailMaxRaw + detailPrefix.length + 1 : 0;
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
    return truncateLine(formatMessage(task.message), Math.min(48, Math.max(8, Math.floor(width * 0.24))));
  });
  const maxMessageLength = messageTexts.reduce((max, value) => Math.max(max, displayWidth(value)), 0);
  const padMessage = (value) => padVisible(value || '', maxMessageLength);
  const statusWidth = Math.max(
    3,
    displayTasks.reduce((max, task) => {
      if (!task?.status || task.status === 'running') return max;
      const text = task.status === 'done'
        ? statusDone
        : task.status === 'failed'
          ? statusFail
          : `(${task.status})`;
      return Math.max(max, displayWidth(text));
    }, 0)
  );
  const indentWidth = displayWidth(`${LINE_PREFIX_TRANSPARENT}${LINE_PREFIX_SHADED}`);
  const layout = resolveRowCellBudget({
    width: width - 1, fixed: indentWidth + labelWidth + 2 + 1 + 1 + statusWidth,
    suffix: maxSuffixLength, rate: maxRateLength, detail: detailWidth,
    message: maxMessageLength, policy: detailPolicy
  });
  return {
    now,
    extrasByTask,
    benchPrefixes,
    taskLabels,
    labelWidth,
    suffixes,
    padSuffix,
    padRate,
    padDetail,
    padMessage,
    detailTexts,
    messageTexts,
    statusWidth,
    layout
  };
};
