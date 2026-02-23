import { resolveDictionaryAndQueryPlan } from './planning.js';
import { buildIndexSignatureInput } from './signature-input.js';

/**
 * Resolve dictionary context + query plan with normalized index-signature input.
 *
 * @param {{
 *   stageTracker:object,
 *   throwIfAborted:()=>void,
 *   rootDir:string,
 *   userConfig:object,
 *   metricsDir:string,
 *   query:string,
 *   argv:object,
 *   runCode:boolean,
 *   runProse:boolean,
 *   runExtractedProseRaw:boolean,
 *   runRecords:boolean,
 *   langFilter:any,
 *   queryPlanCache:object|null,
 *   planInput:object,
 *   fileChargramN:number,
 *   useSqlite:boolean,
 *   backendLabel:string,
 *   sqliteCodePath:string,
 *   sqliteProsePath:string,
 *   sqliteExtractedProsePath:string,
 *   joinComments:boolean,
 *   asOfContext:object|null
 * }} input
 * @returns {Promise<{queryPlan:object,planIndexSignaturePayload:object}>}
 */
export const resolveRunSearchDictionaryAndPlan = ({
  stageTracker,
  throwIfAborted,
  rootDir,
  userConfig,
  metricsDir,
  query,
  argv,
  runCode,
  runProse,
  runExtractedProseRaw,
  runRecords,
  langFilter,
  queryPlanCache,
  planInput,
  fileChargramN,
  useSqlite,
  backendLabel,
  sqliteCodePath,
  sqliteProsePath,
  sqliteExtractedProsePath,
  joinComments,
  asOfContext
}) => {
  return resolveDictionaryAndQueryPlan({
    stageTracker,
    throwIfAborted,
    rootDir,
    userConfig,
    metricsDir,
    query,
    argv,
    runCode,
    runProse,
    runExtractedProse: runExtractedProseRaw,
    runRecords,
    langFilter,
    queryPlanCache,
    planInput,
    fileChargramN,
    indexSignatureInput: buildIndexSignatureInput({
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
    })
  });
};
