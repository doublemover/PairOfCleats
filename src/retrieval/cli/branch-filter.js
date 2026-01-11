import simpleGit from 'simple-git';
import { loadBranchFromMetrics } from './options.js';

export const resolveRepoBranch = async ({ root, metricsDir, runCode, runProse }) => {
  const fromMetrics = runCode ? loadBranchFromMetrics(metricsDir, 'code') : null;
  const fromProse = !fromMetrics && runProse ? loadBranchFromMetrics(metricsDir, 'prose') : null;
  if (fromMetrics || fromProse) return fromMetrics || fromProse;
  try {
    const git = simpleGit(root);
    const status = await git.status();
    return status.current || null;
  } catch {
    return null;
  }
};

export const applyBranchFilter = async ({
  branchFilter,
  caseSensitive,
  root,
  metricsDir,
  runCode,
  runProse,
  backendLabel,
  backendPolicy,
  emitOutput,
  jsonOutput,
  recordSearchMetrics,
  warn = console.warn,
  repoBranch: repoBranchInput,
  resolveBranch
} = {}) => {
  if (!branchFilter) {
    return { matched: true, repoBranch: null, payload: null };
  }
  const resolve = resolveBranch || resolveRepoBranch;
  const repoBranch = repoBranchInput ?? await resolve({ root, metricsDir, runCode, runProse });
  const normalizedBranch = caseSensitive ? branchFilter : branchFilter.toLowerCase();
  const normalizedRepo = repoBranch ? (caseSensitive ? repoBranch : repoBranch.toLowerCase()) : null;
  const branchMatches = normalizedRepo ? normalizedRepo === normalizedBranch : true;
  if (repoBranch && !branchMatches) {
    const payload = {
      backend: backendLabel,
      prose: [],
      code: [],
      records: [],
      stats: {
        branch: repoBranch,
        branchFilter,
        branchMatch: false,
        backendPolicy
      }
    };
    if (emitOutput) {
      if (jsonOutput) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.log(`Branch filter ${branchFilter} did not match current branch ${repoBranch}; returning no results.`);
      }
    }
    if (recordSearchMetrics) {
      recordSearchMetrics('ok');
    }
    return { matched: false, repoBranch, payload };
  }
  if (!repoBranch && warn) {
    warn('Branch filter requested but repo branch is unavailable; continuing without branch validation.');
  }
  return { matched: true, repoBranch, payload: null };
};
