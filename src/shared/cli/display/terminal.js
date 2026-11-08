import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const normalizeProgressMode = (value) => {
  if (value === false || value === 'false' || value === 'off' || value === 'none') return 'off';
  if (value === 'jsonl' || value === 'json') return 'jsonl';
  if (value === 'tty') return 'tty';
  if (value === 'log') return 'log';
  return 'auto';
};

export const resolveTerminal = (stream) => {
  // Machine output and redirected logs do not acquire a terminal runtime.
  const terminalKitModule = require('terminal-kit');
  const terminalKit = terminalKitModule?.default || terminalKitModule;
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

export const resolveWidth = (term, stream) => {
  if (term && Number.isFinite(term.width) && term.width > 1) return Math.floor(term.width);
  if (stream && Number.isFinite(stream.columns) && stream.columns > 1) return Math.floor(stream.columns);
  return 120;
};
