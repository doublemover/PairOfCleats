import { log } from '../../../shared/progress.js';

export function resolveTokenMode({ indexingConfig = {}, state, fileCounts }) {
  const tokenModeRaw = indexingConfig.chunkTokenMode || 'auto';
  const tokenMode = ['auto', 'full', 'sample', 'none'].includes(tokenModeRaw)
    ? tokenModeRaw
    : 'auto';
  const tokenMaxFiles = Number.isFinite(Number(indexingConfig.chunkTokenMaxFiles))
    ? Math.max(0, Number(indexingConfig.chunkTokenMaxFiles))
    : 5000;
  const tokenMaxTotalRaw = Number(indexingConfig.chunkTokenMaxTokens);
  const tokenMaxTotal = Number.isFinite(tokenMaxTotalRaw) && tokenMaxTotalRaw > 0
    ? Math.floor(tokenMaxTotalRaw)
    : 5000000;
  const tokenSampleSize = Number.isFinite(Number(indexingConfig.chunkTokenSampleSize))
    ? Math.max(1, Math.floor(Number(indexingConfig.chunkTokenSampleSize)))
    : 32;
  let resolvedTokenMode = tokenMode === 'auto'
    ? ((fileCounts?.candidates ?? 0) <= tokenMaxFiles ? 'full' : 'sample')
    : tokenMode;
  if (resolvedTokenMode === 'full' && tokenMode === 'auto') {
    let totalTokens = 0;
    for (const chunk of state.chunks) {
      const count = Number.isFinite(chunk?.tokenCount)
        ? chunk.tokenCount
        : (Array.isArray(chunk?.tokens) ? chunk.tokens.length : 0);
      totalTokens += count;
      if (totalTokens > tokenMaxTotal) break;
    }
    if (totalTokens > tokenMaxTotal) {
      resolvedTokenMode = 'sample';
      log(`Chunk token mode auto -> sample (token budget ${totalTokens} > ${tokenMaxTotal}).`);
    }
  }
  return {
    tokenMode,
    resolvedTokenMode,
    tokenMaxFiles,
    tokenMaxTotal,
    tokenSampleSize
  };
}
