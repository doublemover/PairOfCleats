/**
 * Build index-signature input payload for query-plan caching/invalidation.
 *
 * @param {{
 *   useSqlite:boolean,
 *   backendLabel:string,
 *   sqliteCodePath:string,
 *   sqliteProsePath:string,
 *   sqliteExtractedProsePath:string,
 *   runRecords:boolean,
 *   runExtractedProseRaw:boolean,
 *   joinComments:boolean,
 *   rootDir:string,
 *   userConfig:object,
 *   asOfContext:object|null
 * }} input
 * @returns {object}
 */
export const buildIndexSignatureInput = ({
  useSqlite,
  backendLabel,
  sqliteCodePath,
  sqliteProsePath,
  sqliteExtractedProsePath,
  runRecords,
  runExtractedProseRaw,
  joinComments,
  rootDir,
  userConfig,
  asOfContext
}) => ({
  useSqlite,
  backendLabel,
  sqliteCodePath,
  sqliteProsePath,
  sqliteExtractedProsePath,
  runRecords,
  runExtractedProse: runExtractedProseRaw,
  includeExtractedProse: runExtractedProseRaw || joinComments,
  root: rootDir,
  userConfig,
  indexDirByMode: asOfContext?.strict ? asOfContext.indexDirByMode : null,
  indexBaseRootByMode: asOfContext?.strict ? asOfContext.indexBaseRootByMode : null,
  explicitRef: asOfContext?.strict === true,
  asOfContext
});
