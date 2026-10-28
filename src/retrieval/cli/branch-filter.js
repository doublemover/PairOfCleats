import { runScmCommand } from '../../index/scm/runner.js';
import { createError, ERROR_CODES } from '../../shared/error-codes.js';
import { throwIfAborted } from '../../shared/abort.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';

/** Current checkout authority, independently of selected historical indexes. */
export const resolveRepoBranch = async ({ root, signal = null }) => {
  throwIfAborted(signal);
  try {
    const result = await runScmCommand('git', ['-C', root, 'rev-parse', 'HEAD', '--symbolic-full-name', 'HEAD'], {
      signal, timeoutMs: 3000, maxOutputBytes: 4096, outputEncoding: 'utf8', rejectOnNonZeroExit: false,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)))
    });
    throwIfAborted(signal);
    if (result.exitCode !== 0 || result.signal) return { branch: null, revision: null, reason: 'unavailable' };
    if (result.outputCapture?.stdout?.truncated || result.outputCapture?.stdout?.encodingLoss) {
      return { branch: null, revision: null, reason: 'invalid-observation' };
    }
    const lines = String(result.stdout || '').trim().split(/\r?\n/);
    if (lines.length !== 2 || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(lines[0])) {
      return { branch: null, revision: null, reason: 'invalid-observation' };
    }
    const revision = lines[0];
    return lines[1].startsWith('refs/heads/') && lines[1].length > 11
      ? { branch: lines[1].slice(11), revision, reason: null }
      : { branch: null, revision, reason: 'detached' };
  } catch (error) {
    const observation = observeStorageResource(error, { phase: 'search-current-branch' });
    observation.requireSettled();
    throwIfAborted(signal);
    if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') throw error;
    return { branch: null, revision: null, reason: 'unavailable' };
  }
};

export const applyBranchFilter = async ({
  branchFilter, caseSensitive, root, backendLabel, backendPolicy, emitOutput,
  jsonOutput, recordSearchMetrics, repoBranch: repoBranchInput, resolveBranch, signal = null, beforePublish = null
} = {}) => {
  throwIfAborted(signal);
  if (!branchFilter) return { matched: true, repoBranch: null, payload: null, receipt: null };
  const observed = repoBranchInput !== undefined ? repoBranchInput
    : await (resolveBranch || resolveRepoBranch)({ root, signal });
  throwIfAborted(signal);
  // String injection is retained only for existing internal predicate fixtures.
  const repoBranch = typeof observed === 'string' ? observed : observed?.branch || null;
  const matches = repoBranch !== null && (caseSensitive ? repoBranch === branchFilter
    : repoBranch.toLowerCase() === branchFilter.toLowerCase());
  const receipt = Object.freeze({ requested: branchFilter, observed: repoBranch,
    basis: 'current-checkout', revision: typeof observed === 'object' ? observed?.revision || null : null,
    state: repoBranch ? matches ? 'verified' : 'mismatch' : 'unavailable',
    reason: repoBranch ? null : observed?.reason || 'unavailable' });
  if (!repoBranch) {
    throw createError(ERROR_CODES.CAPABILITY_MISSING, 'Requested branch filter cannot be verified against the current checkout.',
      { branchQualification: receipt, details: { branchQualification: receipt } });
  }
  if (!matches) {
    const payload = { backend: backendLabel, prose: [], code: [], extractedProse: [], records: [], stats: {
      branch: repoBranch, branchFilter, branchMatch: false, branchQualification: receipt, backendPolicy
    } };
    if (beforePublish) await beforePublish();
    throwIfAborted(signal);
    if (emitOutput) {
      if (jsonOutput) console.log(JSON.stringify(payload, null, 2));
      else console.error(`Branch filter ${branchFilter} did not match current branch ${repoBranch}; returning no results.`);
    }
    recordSearchMetrics?.('ok');
    return { matched: false, repoBranch, payload, receipt };
  }
  return { matched: true, repoBranch, payload: null, receipt };
};
