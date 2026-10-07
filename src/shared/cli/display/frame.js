import { moveCursorDown, moveCursorUp } from './cursor.js';
import { truncateLine } from './text.js';

export const buildDisplayFrameLines = ({ state, taskLines, width, logWindowSize }) => {
  const statusLine = state.statusLine;
  const logSlots = Math.max(0, logWindowSize - (statusLine ? 1 : 0));
  const logLines = state.logLines.slice(-logSlots);
  while (logLines.length < logSlots) logLines.push('');
  if (statusLine) logLines.push(statusLine);
  return [...logLines, '', ...taskLines, ''].map((rawLine) => truncateLine(rawLine || '', width));
};

export const writeDisplayFrame = ({ state, term, lines }) => {
  const totalLines = lines.length;

  if (!state.rendered) {
    term('\n'.repeat(totalLines));
    state.rendered = true;
    state.renderLines = totalLines;
  } else if (totalLines > state.renderLines) {
    term('\n'.repeat(totalLines - state.renderLines));
    state.renderLines = totalLines;
  }

  const frameLines = [...lines];
  while (frameLines.length < state.renderLines) frameLines.push('');
  while (state.renderFrame.length < state.renderLines) state.renderFrame.push('');

  const changedRows = [];
  for (let index = 0; index < state.renderLines; index += 1) {
    if ((state.renderFrame[index] || '') !== (frameLines[index] || '')) {
      changedRows.push(index);
    }
  }
  if (!changedRows.length) return;

  moveCursorUp(term, state.renderLines);
  let cursorRow = 0;
  for (const row of changedRows) {
    moveCursorDown(term, row - cursorRow);
    term('\r');
    term.eraseLine();
    term(frameLines[row] || '');
    term('\n');
    cursorRow = row + 1;
  }
  moveCursorDown(term, state.renderLines - cursorRow);
  state.renderFrame = frameLines;
};
