import { applyBranchFilter } from '../branch-filter.js';

/**
 * Apply branch prefilter gate and return early payload when it short-circuits.
 *
 * @param {{
 *   branchFilter:string|null,
 *   caseFile:boolean,
 *   rootDir:string,
 *   metricsDir:string,
 *   queryCacheDir:string,
 *   runCode:boolean,
 *   runProse:boolean,
 *   backendLabel:string,
 *   backendPolicyInfo:any,
 *   emitOutput:boolean,
 *   jsonOutput:boolean,
 *   recordSearchMetrics:(status:string)=>void
 * }} input
 * @returns {Promise<object|null>}
 */
export const runBranchFilterGate = async ({
  branchFilter,
  caseFile,
  rootDir,
  metricsDir,
  queryCacheDir,
  runCode,
  runProse,
  backendLabel,
  backendPolicyInfo,
  emitOutput,
  jsonOutput,
  recordSearchMetrics
}) => {
  const branchResult = await applyBranchFilter({
    branchFilter,
    caseSensitive: caseFile,
    root: rootDir,
    metricsDir,
    queryCacheDir,
    runCode,
    runProse,
    backendLabel,
    backendPolicy: backendPolicyInfo,
    emitOutput,
    jsonOutput,
    recordSearchMetrics,
    warn: console.warn
  });
  return branchResult?.payload || null;
};
