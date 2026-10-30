export { lineColToOffset, offsetToLine } from '../../shared/lines.js';

/** CPython physical lines, with offsets into the unchanged original string. */
export const buildLineIndex = text => {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\r') {
      if (text[index+1] === '\n') index++;
      starts.push(index+1);
    } else if (text[index] === '\n') starts.push(index+1);
  }
  return starts;
};
export const splitPythonPhysicalLines = text => text.split(/\r\n|\r|\n/u);
