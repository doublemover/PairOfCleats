import { ANSI, applyLineBackground, stripAnsi as stripAnsiShared } from '../../../shared/cli/ansi-utils.js';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

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

const SGR = /^\x1b\[[0-9;]*m$/u;
const UNSAFE_TERMINAL_TEXT = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;
const sanitizeLinkLabel = (value) => String(value).split(/(\x1b\[[0-9;]*m)/gu).map((part) => (
  SGR.test(part) ? part : stripVTControlCharacters(part).replace(UNSAFE_TERMINAL_TEXT,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
)).join('');
const isWindowsAbsolute = (value) => /^[a-z]:[\\/]/iu.test(value) || /^\x5c\x5c[^\x5c]+\x5c[^\x5c]+/u.test(value);

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
  const file = String(filePath || '');
  const root = String(rootDir || process.cwd());
  // Explicit paths keep their own platform's semantics, even when displayed on
  // another host. A POSIX backslash is a filename character, not a separator.
  const windows = isWindowsAbsolute(file) ? true : file.startsWith('/') ? false
    : isWindowsAbsolute(root) ? true : root.startsWith('/') ? false : process.platform === 'win32';
  const pathApi = windows ? path.win32 : path.posix;
  const absolutePath = pathApi.resolve(root, file);
  try {
    if (effectiveMode === 'vscode') {
      const normalized = windows ? absolutePath.replace(/\\/g, '/') : absolutePath;
      const lineNumber = Number(line);
      const columnNumber = Number(column);
      const linePart = Number.isSafeInteger(lineNumber) && lineNumber > 0
        ? `:${lineNumber}:${Number.isSafeInteger(columnNumber) && columnNumber > 0 ? columnNumber : 1}` : '';
      const encodedPath = encodeURI(normalized).replace(/[?#]/gu, (char) => encodeURIComponent(char));
      return `vscode://file/${encodedPath}${linePart}`;
    }
    return pathToFileURL(absolutePath, { windows }).href;
  } catch {
    return null;
  }
};

export const hyperlinkText = (text, href) => {
  const label = sanitizeLinkLabel(text);
  if (!href || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(String(href))) return label;
  return `${OSC.open}${href}${OSC.terminator}${label}${OSC.close}`;
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
