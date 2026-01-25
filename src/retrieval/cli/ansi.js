import { ANSI, wrapAnsi } from '../../shared/cli/ansi-utils.js';

export const color = {
  green: wrapAnsi(ANSI.fgGreen),
  yellow: wrapAnsi(ANSI.fgYellow),
  red: wrapAnsi(ANSI.fgRed),
  cyan: wrapAnsi(ANSI.fgCyan),
  magenta: wrapAnsi(ANSI.fgMagenta),
  blue: wrapAnsi(ANSI.fgBlue),
  gray: wrapAnsi(ANSI.fgDarkGray),
  bold: wrapAnsi(ANSI.bold),
  underline: wrapAnsi('\x1b[4m')
};
