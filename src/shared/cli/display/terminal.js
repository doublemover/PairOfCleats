import terminalKitModule from 'terminal-kit';

const terminalKit = terminalKitModule?.default || terminalKitModule;

export const normalizeProgressMode = (value) => {
  if (value === false || value === 'false' || value === 'off' || value === 'none') return 'off';
  if (value === 'jsonl' || value === 'json') return 'jsonl';
  return 'auto';
};

export const resolveTerminal = (stream) => {
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
  if (term && Number.isFinite(term.width)) return term.width;
  if (stream && Number.isFinite(stream.columns)) return stream.columns;
  return 120;
};
