import { ANSI, applyLineBackground, stripAnsi as stripAnsiShared } from '../../../shared/cli/ansi-utils.js';

export { ANSI, applyLineBackground };

export const stripAnsi = (value) => stripAnsiShared(String(value));

export const styleText = (text, ...codes) => (
  codes.length ? `${codes.join('')}${text}${ANSI.reset}` : String(text)
);

export const colorText = (text, color) => (color ? styleText(text, color) : String(text));

export const boldText = (text) => styleText(text, ANSI.bold);

export const italicColor = (text, color) => styleText(text, ANSI.italic, color);

export const labelToken = (label, color = '') => (
  `${ANSI.bold}${color}${label}${ANSI.fgBrightWhite}:${ANSI.reset}`
);

export const BG_IMPORTS = '\x1b[48;5;52m';
export const BG_EXPORTS = '\x1b[48;5;23m';
export const BG_CALLS = '\x1b[48;5;17m';
export const BG_CALL_SUMMARY = '\x1b[48;5;17m';
export const BG_IMPORT_LINKS = '\x1b[48;5;22m';
