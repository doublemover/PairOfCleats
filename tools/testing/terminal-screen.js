const CSI_FINAL_PATTERN = /[@-~]/u;

const createBlankRow = (columns) => Array.from({ length: columns }, () => ' ');

const clamp = (value, min, max) => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const createScreenState = (columns, rows) => ({
  columns,
  rows,
  grid: Array.from({ length: rows }, () => createBlankRow(columns)),
  row: 0,
  column: 0,
  savedRow: 0,
  savedColumn: 0,
  wrapCount: 0
});

const clearRowRange = (row, start, end, state) => {
  if (row < 0 || row >= state.rows) return;
  const safeStart = clamp(start, 0, state.columns);
  const safeEnd = clamp(end, 0, state.columns);
  for (let index = safeStart; index < safeEnd; index += 1) {
    state.grid[row][index] = ' ';
  }
};

const clearScreen = (state) => {
  for (let row = 0; row < state.rows; row += 1) {
    clearRowRange(row, 0, state.columns, state);
  }
};

const scrollDown = (state) => {
  state.grid.shift();
  state.grid.push(createBlankRow(state.columns));
  state.row = state.rows - 1;
};

const moveCursor = (state, row, column) => {
  state.row = clamp(row, 0, state.rows - 1);
  state.column = clamp(column, 0, state.columns - 1);
};

const newline = (state) => {
  state.row += 1;
  if (state.row >= state.rows) {
    scrollDown(state);
  }
};

const advanceColumn = (state, count = 1) => {
  state.column += Math.max(0, count);
  while (state.column >= state.columns) {
    state.wrapCount += 1;
    state.column -= state.columns;
    newline(state);
  }
};

const writeChar = (state, char) => {
  if (!char) return;
  if (state.column >= state.columns) {
    state.wrapCount += 1;
    state.column = 0;
    newline(state);
  }
  state.grid[state.row][state.column] = char;
  state.column += 1;
  if (state.column >= state.columns) {
    state.wrapCount += 1;
    state.column = 0;
    newline(state);
  }
};

const applyCarriageReturn = (state) => {
  state.column = 0;
};

const applyTab = (state) => {
  const nextStop = Math.min(
    state.columns - 1,
    Math.floor(state.column / 8) * 8 + 8
  );
  if (nextStop <= state.column) {
    writeChar(state, ' ');
    return;
  }
  while (state.column < nextStop) {
    writeChar(state, ' ');
  }
};

const eraseLine = (state, mode = 0) => {
  if (mode === 1) {
    clearRowRange(state.row, 0, state.column + 1, state);
    return;
  }
  if (mode === 2) {
    clearRowRange(state.row, 0, state.columns, state);
    return;
  }
  clearRowRange(state.row, state.column, state.columns, state);
};

const eraseChars = (state, count = 1) => {
  clearRowRange(state.row, state.column, state.column + Math.max(1, count), state);
};

const eraseDisplay = (state, mode = 0) => {
  if (mode === 2 || mode === 3) {
    clearScreen(state);
    return;
  }
  if (mode === 1) {
    for (let row = 0; row < state.row; row += 1) {
      clearRowRange(row, 0, state.columns, state);
    }
    clearRowRange(state.row, 0, state.column + 1, state);
    return;
  }
  clearRowRange(state.row, state.column, state.columns, state);
  for (let row = state.row + 1; row < state.rows; row += 1) {
    clearRowRange(row, 0, state.columns, state);
  }
};

const parseCsiArgs = (raw) => {
  const text = String(raw || '');
  if (!text) return [];
  return text.split(';').map((entry) => {
    if (!entry) return null;
    const parsed = Number.parseInt(entry, 10);
    return Number.isFinite(parsed) ? parsed : null;
  });
};

const applyCsi = (state, finalByte, args) => {
  const first = args[0] ?? null;
  switch (finalByte) {
    case 'A':
      moveCursor(state, state.row - (first || 1), state.column);
      return;
    case 'B':
      moveCursor(state, state.row + (first || 1), state.column);
      return;
    case 'C':
      advanceColumn(state, first || 1);
      return;
    case 'D':
      moveCursor(state, state.row, state.column - (first || 1));
      return;
    case 'G':
      moveCursor(state, state.row, Math.max(0, (first || 1) - 1));
      return;
    case 'H':
    case 'f': {
      const row = Math.max(1, args[0] || 1) - 1;
      const column = Math.max(1, args[1] || 1) - 1;
      moveCursor(state, row, column);
      return;
    }
    case 'J':
      eraseDisplay(state, first || 0);
      return;
    case 'K':
      eraseLine(state, first || 0);
      return;
    case 'X':
      eraseChars(state, first || 1);
      return;
    case 's':
      state.savedRow = state.row;
      state.savedColumn = state.column;
      return;
    case 'u':
      moveCursor(state, state.savedRow, state.savedColumn);
      return;
    case 'm':
    default:
      return;
  }
};

const consumeOsc = (input, startIndex) => {
  let index = startIndex;
  while (index < input.length) {
    const char = input[index];
    if (char === '\u0007') {
      return index + 1;
    }
    if (char === '\u001b' && input[index + 1] === '\\') {
      return index + 2;
    }
    index += 1;
  }
  return input.length;
};

const consumeCsi = (state, input, startIndex) => {
  let index = startIndex;
  let payload = '';
  while (index < input.length) {
    const char = input[index];
    payload += char;
    if (CSI_FINAL_PATTERN.test(char)) {
      const args = parseCsiArgs(payload.slice(0, -1));
      applyCsi(state, char, args);
      return index + 1;
    }
    index += 1;
  }
  return input.length;
};

export const reconstructTerminalScreen = (value, {
  columns = 120,
  rows = 30
} = {}) => {
  const safeColumns = Number.isFinite(Number(columns)) && Number(columns) >= 20 ? Number(columns) : 120;
  const safeRows = Number.isFinite(Number(rows)) && Number(rows) >= 10 ? Number(rows) : 30;
  const state = createScreenState(safeColumns, safeRows);
  const input = String(value ?? '');

  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (char === '\u001b') {
      const next = input[index + 1];
      if (next === '[') {
        index = consumeCsi(state, input, index + 2);
        continue;
      }
      if (next === ']') {
        index = consumeOsc(input, index + 2);
        continue;
      }
      if (next === '7') {
        state.savedRow = state.row;
        state.savedColumn = state.column;
        index += 2;
        continue;
      }
      if (next === '8') {
        moveCursor(state, state.savedRow, state.savedColumn);
        index += 2;
        continue;
      }
      index += 2;
      continue;
    }
    if (char === '\r') {
      applyCarriageReturn(state);
      index += 1;
      continue;
    }
    if (char === '\n') {
      newline(state);
      index += 1;
      continue;
    }
    if (char === '\t') {
      applyTab(state);
      index += 1;
      continue;
    }
    if (char < ' ') {
      index += 1;
      continue;
    }
    const codePoint = input.codePointAt(index);
    const printable = String.fromCodePoint(codePoint);
    writeChar(state, printable);
    index += printable.length;
  }

  const lines = state.grid
    .map((row) => row.join('').replace(/\s+$/u, ''));
  while (lines.length > 0 && !lines[lines.length - 1]) {
    lines.pop();
  }
  const blankPairCount = lines.reduce((count, line, lineIndex) => (
    lineIndex > 0 && !line && !lines[lineIndex - 1] ? count + 1 : count
  ), 0);
  const usedWidth = lines.reduce((max, line) => Math.max(max, line.length), 0);

  return {
    text: lines.length ? `${lines.join('\n')}\n` : '',
    lines,
    stats: {
      columns: safeColumns,
      rows: safeRows,
      wrapCount: state.wrapCount,
      blankPairCount,
      usedWidth,
      lineCount: lines.length,
      nonEmptyLineCount: lines.filter(Boolean).length
    }
  };
};

export const summarizeRenderedTerminal = (rendered, {
  columns = 120
} = {}) => {
  const text = String(rendered || '');
  const lines = text.replace(/\n$/u, '').split('\n');
  const normalizedLines = lines.length === 1 && !lines[0] ? [] : lines;
  const safeColumns = Number.isFinite(Number(columns)) && Number(columns) >= 20 ? Number(columns) : 120;
  return {
    columns: safeColumns,
    lineCount: normalizedLines.length,
    nonEmptyLineCount: normalizedLines.filter(Boolean).length,
    usedWidth: normalizedLines.reduce((max, line) => Math.max(max, line.length), 0),
    overflowCount: normalizedLines.reduce((count, line) => count + (line.length > safeColumns ? 1 : 0), 0),
    blankPairCount: normalizedLines.reduce((count, line, lineIndex) => (
      lineIndex > 0 && !line && !normalizedLines[lineIndex - 1] ? count + 1 : count
    ), 0)
  };
};
