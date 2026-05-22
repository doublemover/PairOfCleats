import { resolveWidth } from './terminal.js';
import { BAR_STYLES, buildBar } from './bar.js';
import {
  BLACK,
  STATUS_BRACKET_FG,
  CHECK_FG_OK,
  CHECK_FG_FAIL,
  clampBackgroundColor,
  makeTextForeground,
  makeBarForeground,
  colorToAnsi,
  composeColor,
  mixColor,
  scaleColor,
  resolveGradientColor
} from './colors.js';
import {
  stripAnsi,
  formatCount,
  padLabel,
  padVisible
} from './text.js';
import {
  computeOverallProgress,
  LINE_PREFIX_SHADED,
  LINE_PREFIX_TRANSPARENT,
  resolveBarVariant
} from './progress.js';
import { buildDisplayFrameLines, writeDisplayFrame } from './frame.js';
import {
  groupDisplayTasksByMode,
  resolveDisplayLayout,
  resolveOrderedDisplayTasks
} from './layout.js';
import { resolveDisplayPalette, resolveTaskShades } from './palette.js';

const clampRatio = (value) => Math.min(1, Math.max(0, value));

export const renderDisplay = ({
  state,
  term,
  stream,
  interactive,
  canRender,
  colorEnabled,
  logWindowSize
}) => {
  if (!interactive || !canRender) return;
  const width = resolveWidth(term, stream);
  const { orderedTasks, displayTasks } = resolveOrderedDisplayTasks(state);
  const { tasksByMode, overallTask } = groupDisplayTasksByMode(orderedTasks);
  const overallOverride = computeOverallProgress({ overallTask, tasksByMode });
  const {
    taskColors,
    taskAccents,
    taskShades,
    paletteOffset,
    paletteStep,
    resolveBackgroundColor
  } = resolveDisplayPalette({ state, displayTasks, tasksByMode });
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
  const statusFail = buildStatusFail();
  const {
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
  } = resolveDisplayLayout({ displayTasks, width, statusDone, statusFail });
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
    const shades = resolveTaskShades(taskShades, task.id, baseColor);
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
          ? statusFail
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

  const lines = buildDisplayFrameLines({ state, taskLines, width, logWindowSize });
  writeDisplayFrame({ state, term, lines });
};
