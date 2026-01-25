import path from 'node:path';
import {
  ANSI,
  applyLineBackground as applyLineBackgroundRaw,
  colorize,
  stripAnsi,
  padEndVisible,
  createThresholdScale
} from '../src/shared/cli/ansi-utils.js';

export const TIME_LABEL_COLOR = ANSI.fgDarkGray;
export const TIME_BRACKET_COLOR = `${ANSI.dim}${ANSI.fgDarkGray}`;

export const applyLineBackground = (text, { useColor = false, columns = 0, bg = ANSI.bgBlack } = {}) => (
  applyLineBackgroundRaw(text, { enabled: useColor, columns, bg })
);

export const formatDuration = (ms) => {
  if (!Number.isFinite(ms)) return '0ms';
  if (ms >= 10000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
};

export const formatDurationCell = (ms) => {
  const text = formatDuration(ms);
  const width = 6;
  if (text.length >= width) return text;
  return `${' '.repeat(width - text.length)}${text}`;
};

export const formatLabel = (label, { useColor = false, mode = 'plain' } = {}) => {
  if (!useColor) return label;
  if (mode === 'pass') return `${ANSI.bgBlack}${ANSI.fgGreen}${label}${ANSI.reset}`;
  if (mode === 'fail') return `${ANSI.bgBlack}${ANSI.fgRed}${label}${ANSI.reset}`;
  if (mode === 'warn') return `${ANSI.fgYellow}${label}${ANSI.reset}`;
  if (mode === 'log') return `${ANSI.bgBlack}${ANSI.fgLightBlue}${label}${ANSI.reset}`;
  if (mode === 'skip') return `${ANSI.bgBlack}${ANSI.fgPink}${label}${ANSI.reset}`;
  return label;
};

export const formatDurationBadge = (ms, { useColor = false } = {}) => {
  const inner = formatDurationCell(ms);
  const trimmed = inner.trim();
  const unit = trimmed.endsWith('ms') ? 'ms' : 's';
  const numberPart = inner.slice(0, inner.length - unit.length);
  if (!useColor) return `[${inner}]`;
  const bracketColor = TIME_BRACKET_COLOR;
  const suffixColor = TIME_LABEL_COLOR;
  return `${ANSI.bgBlack}${bracketColor}[${ANSI.fgBrightWhite}${numberPart}${suffixColor}${unit}` +
    `${ANSI.reset}${ANSI.bgBlack}${bracketColor}]${ANSI.reset}`;
};

export const formatDurationValue = (ms, { useColor = false } = {}) => {
  const text = formatDuration(ms);
  if (!useColor) return text;
  const unit = text.endsWith('ms') ? 'ms' : 's';
  const numberPart = text.slice(0, text.length - unit.length);
  return `${ANSI.fgBrightWhite}${numberPart}${TIME_LABEL_COLOR}${unit}${ANSI.reset}`;
};

export const resolveSlowestColor = createThresholdScale(
  [
    { max: 2000, color: ANSI.fgGreen },
    { max: 4000, color: ANSI.fgDarkGreen },
    { max: 7000, color: ANSI.fgYellow },
    { max: 10000, color: ANSI.fgOrange },
    { max: 13000, color: ANSI.fgDarkOrange },
    { max: 16000, color: ANSI.fgBrown },
    { max: 19500, color: ANSI.fgBrownDark }
  ],
  ANSI.fgRed
);

export const formatLogPath = (value, root) => {
  if (!value) return '';
  const baseRoot = root || process.cwd();
  const relative = path.isAbsolute(value) ? path.relative(baseRoot, value) : value;
  const normalized = String(relative || '').replace(/\\/g, '/');
  if (!normalized) return './';
  if (normalized.startsWith('./') || normalized.startsWith('../')) return normalized;
  return `./${normalized}`;
};

export const formatLogLine = (value, { useColor = false, root } = {}) => {
  const label = formatLabel('LOG:', { useColor, mode: 'log' });
  const resolved = formatLogPath(value, root);
  const pad = ' '.repeat(10);
  if (!useColor) return `${label}${pad}${resolved}`;
  return `${label}${pad}${ANSI.fgBrightWhite}${resolved}${ANSI.reset}`;
};

export const formatSummaryLogLine = (value, { useColor = false, root } = {}) => {
  const label = formatLabel('LOG:', { useColor, mode: 'log' });
  const resolved = formatLogPath(value, root);
  if (!useColor) return `${label} ${resolved}`;
  return `${label} ${ANSI.fgBrightWhite}${resolved}${ANSI.reset}`;
};

export const formatSkipReason = (reason, { useColor = false } = {}) => {
  if (!reason) return '';
  const prefix = 'excluded tag:';
  const trimmed = String(reason).trim();
  if (!useColor) return ` (${trimmed})`;
  if (!trimmed.toLowerCase().startsWith(prefix)) {
    return `${ANSI.fgDarkGray} (${trimmed})${ANSI.reset}`;
  }
  const tagsPart = trimmed.slice(prefix.length).trim();
  return `${ANSI.fgDarkGray} (${prefix} ${ANSI.reset}${ANSI.fgPinkDark}${tagsPart}${ANSI.reset}${ANSI.fgDarkGray})${ANSI.reset}`;
};

export const buildBorder = (pattern, length) => {
  if (length <= 0) return '';
  let out = '';
  while (out.length < length) out += pattern;
  return out.slice(0, length);
};

export const colorizeBorder = (border, useColor) => {
  if (!useColor) return border;
  return Array.from(border).map((ch) => {
    const dashLike = ch === '-' || ch === '╶' || ch === '╴';
    const color = dashLike ? `${ANSI.dim}${ANSI.fgDarkGray}` : ANSI.fgDarkGray;
    return `${color}${ch}${ANSI.reset}`;
  }).join('');
};

export const padEndRaw = (text, width) => {
  if (text.length >= width) return text;
  return `${text}${' '.repeat(width - text.length)}`;
};

export const wrapList = (items, maxLen) => {
  const lines = [];
  let current = [];
  let currentLen = 0;
  for (const item of items) {
    const itemText = String(item);
    const addLen = (current.length ? 2 : 0) + itemText.length;
    if (current.length && (currentLen + addLen) > maxLen) {
      lines.push(current);
      current = [itemText];
      currentLen = itemText.length;
      continue;
    }
    current.push(itemText);
    currentLen += addLen;
  }
  if (current.length) lines.push(current);
  return lines;
};

export const formatOutputLines = (lines, { useColor = false, columns = 0 } = {}) => {
  if (!lines.length) return '';
  const indented = lines.map((line) => `  ${line}`);
  const colored = indented.map((line) => {
    if (!useColor) return line;
    const tinted = `${ANSI.fgSoftBlue}${line}${ANSI.reset}`;
    return applyLineBackground(tinted, { useColor, columns, bg: ANSI.bgDarkPurple });
  }).join('\n');
  const output = useColor ? colored : indented.join('\n');
  return `${output}\n`;
};

export { ANSI, colorize, stripAnsi, padEndVisible };
