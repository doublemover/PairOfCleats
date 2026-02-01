import { sha1 } from '../shared/hash.js';

export const buildCallSiteId = ({ file, startLine, startCol, endLine, endCol, calleeRaw }) => {
  if (!file || !startLine || !startCol || !endLine || !endCol || !calleeRaw) return null;
  const key = `${file}:${startLine}:${startCol}:${endLine}:${endCol}:${calleeRaw}`;
  return `sha1:${sha1(key)}`;
};
