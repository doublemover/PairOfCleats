import { evaluateAutoSqliteThresholds, resolveIndexStats } from '../auto-sqlite.js';

/**
 * Resolve auto-backend sqlite eligibility against index-size thresholds.
 *
 * @param {{
 *   backendArg:string|null|undefined,
 *   sqliteAvailable:boolean,
 *   needsSqlite:boolean,
 *   sqliteAutoChunkThreshold:number,
 *   sqliteAutoArtifactBytes:number,
 *   runCode:boolean,
 *   runProse:boolean,
 *   runExtractedProse:boolean,
 *   resolveSearchIndexDir:(mode:string)=>string
 * }} input
 * @returns {{
 *   autoBackendRequested:boolean,
 *   autoSqliteAllowed:boolean,
 *   autoSqliteReason:string|null
 * }}
 */
export const resolveAutoSqliteEligibility = ({
  backendArg,
  sqliteAvailable,
  needsSqlite,
  sqliteAutoChunkThreshold,
  sqliteAutoArtifactBytes,
  runCode,
  runProse,
  runExtractedProse,
  resolveSearchIndexDir
}) => {
  const autoChunkThreshold = Number.isFinite(sqliteAutoChunkThreshold)
    ? Math.max(0, Math.floor(sqliteAutoChunkThreshold))
    : 0;
  const autoArtifactThreshold = Number.isFinite(sqliteAutoArtifactBytes)
    ? Math.max(0, Math.floor(sqliteAutoArtifactBytes))
    : 0;
  const autoThresholdsEnabled = autoChunkThreshold > 0 || autoArtifactThreshold > 0;
  const autoBackendRequested = !backendArg || String(backendArg).trim().toLowerCase() === 'auto';
  let autoSqliteAllowed = true;
  let autoSqliteReason = null;
  if (autoThresholdsEnabled && autoBackendRequested && sqliteAvailable && needsSqlite) {
    const collectStats = (mode) => {
      try {
        return resolveIndexStats(resolveSearchIndexDir(mode));
      } catch {
        return null;
      }
    };
    const stats = [];
    if (runCode) {
      const resolved = collectStats('code');
      if (resolved) stats.push({ mode: 'code', ...resolved });
    }
    if (runProse) {
      const resolved = collectStats('prose');
      if (resolved) stats.push({ mode: 'prose', ...resolved });
    }
    if (runExtractedProse) {
      const resolved = collectStats('extracted-prose');
      if (resolved) {
        stats.push({
          mode: 'extracted-prose',
          ...resolved
        });
      }
    }
    const evaluation = evaluateAutoSqliteThresholds({
      stats,
      chunkThreshold: autoChunkThreshold,
      artifactThreshold: autoArtifactThreshold
    });
    if (!evaluation.allowed) {
      autoSqliteAllowed = false;
      autoSqliteReason = evaluation.reason;
    }
  }
  return {
    autoBackendRequested,
    autoSqliteAllowed,
    autoSqliteReason
  };
};
