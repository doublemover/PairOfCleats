import { buildCallSiteId } from '../../../callsite-id.js';

// Callsite-local pointer hash used by risk flow evidence and manifest joins.
// Manifest touchpoints: src/index/build/incremental.js, src/index/build/piece-assembly.js,
// src/shared/artifact-io/manifest.js.
export const buildLocalPointerHash = ({ file, startLine, startCol, endLine, endCol, calleeRaw }) => (
  buildCallSiteId({ file, startLine, startCol, endLine, endCol, calleeRaw })
);
