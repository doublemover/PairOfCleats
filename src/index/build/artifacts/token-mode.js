import { log } from '../../../shared/progress.js';

export function resolveTokenMode({ indexingConfig = {}, state, fileCounts, profileId = null }) {
  const tokenModeRaw = typeof indexingConfig.chunkTokenMode === 'string'
    ? indexingConfig.chunkTokenMode.trim().toLowerCase()
    : 'auto';
  const tokenMode = ['auto', 'full', 'sample', 'none'].includes(tokenModeRaw)
    ? tokenModeRaw
    : 'auto';
  const tokenMaxFilesRaw = Number(indexingConfig.chunkTokenMaxFiles);
  const tokenMaxFiles = Number.isFinite(tokenMaxFilesRaw)
    ? Math.max(0, Math.floor(tokenMaxFilesRaw))
    : 5000;
  const tokenMaxTotalRaw = Number(indexingConfig.chunkTokenMaxTokens);
  const tokenMaxTotal = Number.isFinite(tokenMaxTotalRaw) && tokenMaxTotalRaw > 0
    ? Math.floor(tokenMaxTotalRaw)
    : 5000000;
  const tokenSampleRaw = Number(indexingConfig.chunkTokenSampleSize);
  const tokenSampleSize = Number.isFinite(tokenSampleRaw)
    ? Math.max(1, Math.floor(tokenSampleRaw))
    : 32;
  const profileIdRaw = typeof profileId === 'string'
    ? profileId.trim().toLowerCase()
    : (typeof indexingConfig.profile === 'string'
      ? indexingConfig.profile.trim().toLowerCase()
      : '');
  const vectorOnlyProfile = profileIdRaw === 'vector_only';
  // Artifact token output must stay in lockstep with runtime retention policy:
  // vector_only auto mode keeps full tokens for lexical post-filter correctness.
  const forceFullTokenRetention = vectorOnlyProfile && tokenMode === 'auto';
  let resolvedTokenMode = tokenMode === 'auto'
    ? ((forceFullTokenRetention || (fileCounts?.candidates ?? 0) <= tokenMaxFiles) ? 'full' : 'sample')
    : tokenMode;
  if (resolvedTokenMode === 'full' && tokenMode === 'auto' && !forceFullTokenRetention) {
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
