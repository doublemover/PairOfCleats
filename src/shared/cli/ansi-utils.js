export const ANSI = {
  reset: '\x1b[0m',
  fgGreen: '\x1b[32m',
  fgRed: '\x1b[31m',
  fgYellow: '\x1b[33m',
  fgCyan: '\x1b[36m',
  fgMagenta: '\x1b[35m',
  fgLight: '\x1b[37m',
  fgBlue: '\x1b[34m',
  fgLightBlue: '\x1b[94m',
  fgBrightWhite: '\x1b[97m',
  fgDarkGray: '\x1b[90m',
  fgBlack: '\x1b[30m',
  fgLightGreen: '\x1b[92m',
  fgDarkerCyan: '\x1b[38;5;30m',
  fgPurple: '\x1b[38;5;129m',
  fgSoftBlue: '\x1b[38;5;117m',
  fgPink: '\x1b[38;5;213m',
  fgPinkMuted: '\x1b[38;5;176m',
  fgPinkDark: '\x1b[38;5;168m',
  fgDarkGreen: '\x1b[38;5;22m',
  fgOrangeDeep: '\x1b[38;5;166m',
  fgOrange: '\x1b[38;5;214m',
  fgDarkOrange: '\x1b[38;5;172m',
  fgTimeoutUnit: '\x1b[38;5;124m',
  fgBrown: '\x1b[38;5;130m',
  fgBrownDark: '\x1b[38;5;94m',
  bgBlack: '\x1b[40m',
  bgDarkPurple: '\x1b[48;5;18m',
  bgFailLine: '\x1b[48;5;17m',
  bgLogLine: '\x1b[48;5;18m',
  bgOutputLine: '\x1b[48;5;21m',
  bgOutputTail: '\x1b[48;5;20m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  italic: '\x1b[3m'
};

export const wrapAnsi = (prefix, suffix = ANSI.reset) => (text) => `${prefix}${text}${suffix}`;

export const colorize = (text, color, enabled = true) => (
  enabled ? `${color}${text}${ANSI.reset}` : text
);

export const stripAnsi = (text) => String(text).replace(/\x1b\[[0-9;]*m/g, '');

export const padEndVisible = (text, width) => {
  const visible = stripAnsi(text).length;
  if (visible >= width) return text;
  return `${text}${' '.repeat(width - visible)}`;
};

export const applyLineBackground = (
  text,
  { enabled = true, columns = 0, bg = ANSI.bgBlack } = {}
) => {
  if (!enabled) return text;
  const visible = stripAnsi(text).length;
  const width = Number.isFinite(columns) ? columns : 0;
  let padded = text;
  if (width && visible < width) {
    padded = `${text}${' '.repeat(width - visible)}`;
  }
  const withBg = `${bg}${padded}`.replaceAll(ANSI.reset, `${ANSI.reset}${bg}`);
  return `${withBg}${ANSI.reset}`;
};

export const createThresholdScale = (thresholds, fallback) => {
  const sorted = (Array.isArray(thresholds) ? thresholds : [])
    .filter((entry) => Number.isFinite(entry?.max) && entry?.color)
    .sort((a, b) => a.max - b.max);
  return (value) => {
    if (!Number.isFinite(value)) return fallback;
    for (const entry of sorted) {
      if (value <= entry.max) return entry.color;
    }
    return fallback;
  };
};
