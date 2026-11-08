import { sha1 } from '../shared/hash.js';
export const CALL_SITE_ID_VERSION = 2;

export const buildCallSiteId = ({ file, startLine, startCol, endLine, endCol, calleeRaw }) => {
  if (!file || !calleeRaw) return null;
  const lineCol = [startLine, startCol, endLine, endCol];
  if (lineCol.some((value) => !Number.isFinite(value) || value < 0)) return null;
  const key = JSON.stringify([CALL_SITE_ID_VERSION,file,startLine,startCol,endLine,endCol,calleeRaw]);
  return `sha1:${sha1(key)}`;
};
