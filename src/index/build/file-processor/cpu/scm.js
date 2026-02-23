import { createTimeoutError, runWithTimeout } from '../../../../shared/promise-timeout.js';
import { resolveScmTaskDeadlineMs } from './guardrails.js';
import { resolveNonNegativeNumber, resolvePositiveNumber } from './coercion.js';

/**
 * Read snapshot SCM metadata from a Map-like cache or plain object map.
 *
 * @param {{scmFileMetaByPath:Map<string,object>|Record<string,object>|null|undefined,filePosix:string|null}} input
 * @returns {object|null}
 */
export const readSnapshotMetaForPath = ({ scmFileMetaByPath, filePosix }) => {
  if (!scmFileMetaByPath || !filePosix) return null;
  if (typeof scmFileMetaByPath.get === 'function') {
    return scmFileMetaByPath.get(filePosix) || null;
  }
  return scmFileMetaByPath[filePosix] || null;
};

/**
 * Determine whether cached snapshot metadata is complete enough for current needs.
 *
 * @param {{snapshotMeta:object|null,includeChurn:boolean}} input
 * @returns {{hasIdentity:boolean,missingRequestedChurn:boolean,canUseSnapshot:boolean,unavailableReason:string|null}}
 */
export const resolveSnapshotMetaState = ({ snapshotMeta, includeChurn }) => {
  const hasIdentity = Boolean(snapshotMeta && (snapshotMeta.lastModifiedAt || snapshotMeta.lastAuthor));
  const missingRequestedChurn = Boolean(
    hasIdentity
    && includeChurn
    && !Number.isFinite(snapshotMeta?.churn)
    && !Number.isFinite(snapshotMeta?.churnAdded)
    && !Number.isFinite(snapshotMeta?.churnDeleted)
  );
  return {
    hasIdentity,
    missingRequestedChurn,
    canUseSnapshot: hasIdentity && !missingRequestedChurn,
    unavailableReason: snapshotMeta && !hasIdentity ? 'unavailable' : null
  };
};

/**
 * Normalize SCM provider metadata shape into chunk/file metadata fields.
 *
 * @param {object|null} meta
 * @returns {{last_modified:string|null,last_author:string|null,churn:number|null,churn_added:number|null,churn_deleted:number|null,churn_commits:number|null}}
 */
export const toFileGitMeta = (meta) => ({
  last_modified: meta?.lastModifiedAt ?? null,
  last_author: meta?.lastAuthor ?? null,
  churn: Number.isFinite(meta?.churn) ? meta.churn : null,
  churn_added: Number.isFinite(meta?.churnAdded) ? meta.churnAdded : null,
  churn_deleted: Number.isFinite(meta?.churnDeleted) ? meta.churnDeleted : null,
  churn_commits: Number.isFinite(meta?.churnCommits) ? meta.churnCommits : null
});

/**
 * Resolve SCM metadata timeout, applying fast-path caps when required.
 *
 * @param {{scmConfig:object|null|undefined,enforceScmTimeoutCaps:boolean,scmFastPath:boolean,normalizedExt:string,metaFastTimeoutExts:Set<string>}} input
 * @returns {number}
 */
export const resolveScmMetaTimeoutMs = ({
  scmConfig,
  enforceScmTimeoutCaps,
  scmFastPath,
  normalizedExt,
  metaFastTimeoutExts
}) => {
  let timeoutMs = resolvePositiveNumber(scmConfig?.timeoutMs, 2000);
  if (enforceScmTimeoutCaps) {
    const capMs = scmFastPath || metaFastTimeoutExts.has(normalizedExt) ? 250 : 750;
    timeoutMs = Math.min(timeoutMs, capMs);
  }
  return timeoutMs;
};

/**
 * Resolve annotate byte/timeout limits for the current file under SCM guardrails.
 *
 * @param {object} input
 * @returns {{maxAnnotateBytes:number,timeoutMs:number,withinAnnotateCap:boolean}}
 */
export const resolveScmAnnotateLimits = ({
  annotateConfig,
  scmConfig,
  enforceScmTimeoutCaps,
  scmFastPath,
  normalizedExt,
  relKey,
  fileBytes,
  isPythonScmPath,
  annotateFastTimeoutExts,
  annotatePythonMaxBytes,
  annotateFastTimeoutMs,
  annotateHeavyPathTimeoutMs,
  annotateDefaultTimeoutCapMs,
  isHeavyRelationsPath
}) => {
  const defaultAnnotateBytes = scmFastPath ? 128 * 1024 : 256 * 1024;
  const annotateDefaultBytes = isPythonScmPath
    ? Math.min(defaultAnnotateBytes, annotatePythonMaxBytes)
    : defaultAnnotateBytes;
  const maxAnnotateBytes = resolveNonNegativeNumber(
    annotateConfig?.maxFileSizeBytes,
    annotateDefaultBytes
  );
  const defaultTimeout = resolvePositiveNumber(scmConfig?.timeoutMs, 10000);
  let timeoutMs = resolvePositiveNumber(annotateConfig?.timeoutMs, defaultTimeout);
  if (enforceScmTimeoutCaps) {
    const capMs = isHeavyRelationsPath(relKey)
      ? annotateHeavyPathTimeoutMs
      : (
        scmFastPath || annotateFastTimeoutExts.has(normalizedExt)
          ? annotateFastTimeoutMs
          : annotateDefaultTimeoutCapMs
      );
    timeoutMs = Math.min(timeoutMs, capMs);
  }
  const clampedTimeoutMs = Math.max(0, timeoutMs);
  return {
    maxAnnotateBytes,
    timeoutMs: clampedTimeoutMs,
    withinAnnotateCap: maxAnnotateBytes == null || fileBytes <= maxAnnotateBytes
  };
};

/**
 * Execute an SCM task with queue-deadline enforcement.
 *
 * Deadline includes queue wait so SCM saturation does not exceed file-level budgets.
 *
 * @param {{runProc?:function,relKey:string,label:string,timeoutMs:number,task:(signal:AbortSignal|null)=>Promise<unknown>}} input
 * @returns {Promise<unknown>}
 */
export const runScmTaskWithDeadline = async ({
  runProc,
  relKey,
  label,
  timeoutMs,
  task
}) => {
  const runScmTask = typeof runProc === 'function' ? runProc : (fn) => fn();
  const deadlineMs = resolveScmTaskDeadlineMs(timeoutMs);
  if (!(Number.isFinite(deadlineMs) && deadlineMs > 0)) {
    return runScmTask(() => task(null));
  }
  return runWithTimeout(
    (taskSignal) => runScmTask(() => task(taskSignal)),
    {
      timeoutMs: deadlineMs,
      errorFactory: () => createTimeoutError({
        message: `SCM ${label || 'task'} timed out after ${deadlineMs}ms (${relKey})`,
        code: 'SCM_TASK_TIMEOUT',
        retryable: true,
        meta: {
          relKey,
          deadlineMs,
          timeoutMs: Number.isFinite(Number(timeoutMs)) ? Math.floor(Number(timeoutMs)) : null
        }
      })
    }
  );
};
