export { buildChunkEnrichment, createFrameworkProfileResolver } from './enrichment.js';
export {
  coalesceHeavyChunks,
  normalizeHeavyFilePolicy,
  shouldApplySwiftHotPathCoalescing,
  shouldDownshiftForHeavyPath
} from './heavy-policy.js';
export { canUseLineTokenStreamSlice, processChunks } from './token-flow.js';
