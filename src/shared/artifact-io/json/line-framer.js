/**
 * Attempt-local JSONL framing. Search only new decoded fragments and join an
 * unfinished row once, when its delimiter (or EOF) arrives. Counters describe
 * logical search/join work, not engine-specific character comparisons or CPU.
 * The caller admits decoded-stream bytes before passing each fragment here.
 */
export const createJsonlLineFramer = () => {
  let fragments = [], pendingCodeUnits = 0, lineNumber = 0, disposed = false;
  const stats = { delimiterSearchCodeUnits: 0, joinedCodeUnits: 0, joins: 0,
    peakPendingCodeUnits: 0, completedLines: 0 };
  const take = tail => {
    let line;
    if (!fragments.length) line = tail;
    else {
      if (tail.length) fragments.push(tail);
      line = fragments.join(''); stats.joins++; stats.joinedCodeUnits += line.length;
    }
    fragments = []; pendingCodeUnits = 0; lineNumber++; stats.completedLines++;
    return { line: line.endsWith('\r') ? line.slice(0, -1) : line, lineNumber };
  };
  return {
    *push(text) {
      if (disposed) throw new Error('JSONL line framer is disposed.');
      let start = 0;
      while (start < text.length) {
        const newline = text.indexOf('\n', start);
        stats.delimiterSearchCodeUnits += (newline < 0 ? text.length : newline + 1) - start;
        if (newline < 0) {
          const tail = text.slice(start); fragments.push(tail); pendingCodeUnits += tail.length;
          stats.peakPendingCodeUnits = Math.max(stats.peakPendingCodeUnits, pendingCodeUnits);
          break;
        }
        yield take(text.slice(start, newline));
        start = newline + 1;
      }
    },
    finish() {
      if (disposed) throw new Error('JSONL line framer is disposed.');
      return pendingCodeUnits ? take('') : null;
    },
    get pendingCodeUnits() { return pendingCodeUnits; },
    getStats: () => ({ ...stats, pendingCodeUnits, pendingFragments: fragments.length }),
    dispose() { fragments = []; pendingCodeUnits = 0; disposed = true; }
  };
};
