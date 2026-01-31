import { buildCallSiteId } from '../../../callsite-id.js';

export const buildLocalPointerHash = ({ file, startLine, startCol, endLine, endCol, calleeRaw }) => (
  buildCallSiteId({ file, startLine, startCol, endLine, endCol, calleeRaw })
);
