import { sha1 } from '../shared/hash.js';

export const buildCallSiteId = ({ file, startLine, startCol, endLine, endCol, calleeRaw }) => {
  if (!file || !calleeRaw) return null;
  const lineCol = [startLine, startCol, endLine, endCol];
  if (lineCol.some((value) => !Number.isFinite(value) || value < 0)) return null;
  const key = `${file}:${startLine}:${startCol}:${endLine}:${endCol}:${calleeRaw}`;
  return `sha1:${sha1(key)}`;
};
