import { ANSI, applyLineBackground, stripAnsi as stripAnsiShared } from '../../../shared/cli/ansi-utils.js';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export { ANSI, applyLineBackground };

export const stripAnsi = (value) => stripAnsiShared(String(value));

export const styleText = (text, ...codes) => (
  codes.length ? `${codes.join('')}${text}${ANSI.reset}` : String(text)
);

export const colorText = (text, color) => (color ? styleText(text, color) : String(text));

export const boldText = (text) => styleText(text, ANSI.bold);

export const italicColor = (text, color) => styleText(text, ANSI.italic, color);

const OSC = {
  open: '\x1b]8;;',
  close: '\x1b]8;;\x1b\\',
  terminator: '\x1b\\'
};

export const resolveHyperlinkMode = ({
  configuredMode = null,
  env = process.env,
  stdout = process.stdout
} = {}) => {
  const explicit = String(configuredMode || '').trim().toLowerCase();
  if (explicit === 'off' || explicit === 'none' || explicit === '0') return 'off';
  if (explicit === 'file' || explicit === 'vscode') return explicit;
  if (explicit === 'auto' || !explicit) {
    if (env?.CI === '1' || env?.CI === 'true') return 'off';
    if (!stdout?.isTTY) return 'off';
    if (String(env?.TERM_PROGRAM || '').toLowerCase() === 'vscode') return 'vscode';
    if (env?.WT_SESSION || env?.TERM_PROGRAM || env?.VTE_VERSION || env?.KONSOLE_VERSION || env?.DOMTERM) {
      return 'file';
    }
  }
  if (env?.CI === '1' || env?.CI === 'true') return 'off';
  if (!stdout?.isTTY) return 'off';
  if (String(env?.TERM_PROGRAM || '').toLowerCase() === 'vscode') return 'vscode';
  if (env?.WT_SESSION || env?.TERM_PROGRAM || env?.VTE_VERSION || env?.KONSOLE_VERSION || env?.DOMTERM) {
    return 'file';
  }
  return 'off';
};

export const buildFileHyperlink = ({
  filePath,
  line = null,
  column = 1,
  rootDir = process.cwd(),
  mode = null,
  configuredMode = null,
  env = process.env,
  stdout = process.stdout
} = {}) => {
  const effectiveMode = mode || resolveHyperlinkMode({ configuredMode, env, stdout });
  if (effectiveMode === 'off') return null;
  const absolutePath = path.isAbsolute(String(filePath || ''))
    ? path.normalize(String(filePath))
    : path.resolve(rootDir, String(filePath || ''));
  if (effectiveMode === 'vscode') {
    const normalized = absolutePath.replace(/\\/g, '/');
    const linePart = Number.isFinite(Number(line)) ? `:${Number(line)}:${Number.isFinite(Number(column)) ? Number(column) : 1}` : '';
    return encodeURI(`vscode://file/${normalized}${linePart}`);
  }
  return pathToFileURL(absolutePath).href;
};

export const hyperlinkText = (text, href) => {
  if (!href) return String(text);
  return `${OSC.open}${href}${OSC.terminator}${text}${OSC.close}`;
};

export const hyperlinkFileLabel = ({
  label,
  filePath,
  line = null,
  column = 1,
  rootDir = process.cwd(),
  mode = null,
  configuredMode = null,
  env = process.env,
  stdout = process.stdout
} = {}) => {
  const href = buildFileHyperlink({ filePath, line, column, rootDir, mode, configuredMode, env, stdout });
  return hyperlinkText(label, href);
};

export const metaChip = ({
  label = '',
  value = '',
  labelColor = ANSI.fgDarkGray,
  valueColor = '',
  borderColor = ANSI.fgDarkGray
} = {}) => {
  const open = colorText('[', borderColor);
  const close = colorText(']', borderColor);
  const labelPart = label ? `${colorText(label, labelColor)} ` : '';
  const valuePart = valueColor ? colorText(value, valueColor) : String(value);
  return `${open}${labelPart}${valuePart}${close}`;
};

export const labelToken = (label, color = '') => (
  `${ANSI.bold}${color}${label}${ANSI.fgBrightWhite}:${ANSI.reset}`
);

export const BG_IMPORTS = '\x1b[48;5;236m';
export const BG_EXPORTS = '\x1b[48;5;238m';
export const BG_CALLS = '\x1b[48;5;236m';
export const BG_CALL_SUMMARY = '\x1b[48;5;237m';
export const BG_IMPORT_LINKS = '\x1b[48;5;235m';
