/**
 * Normalize run result shape for queue completion/retry transitions.
 *
 * @param {{exitCode?:number,executionMode?:string,daemon?:object|null}|null|undefined} runResult
 * @returns {{exitCode:number,executionMode:'daemon'|'subprocess',daemon:object|null,status:'done'|'failed'}}
 */
const normalizeRunResult = (runResult) => {
  const exitCode = Number.isFinite(runResult?.exitCode) ? runResult.exitCode : 1;
  const executionMode = runResult?.executionMode === 'daemon' ? 'daemon' : 'subprocess';
  const daemon = runResult?.daemon && typeof runResult.daemon === 'object'
    ? runResult.daemon
    : null;
  return {
    exitCode,
    executionMode,
    daemon,
    status: exitCode === 0 ? 'done' : 'failed'
  };
};

/**
 * Build queue completion handlers that centralize retry policy decisions.
 *
 * @param {{
 *   queueDir:string,
 *   resolvedQueueName:string|null,
 *   queueMaxRetries:number|null,
 *   completeJob:(dirPath:string,jobId:string,status:string,result:object,queueName?:string|null)=>Promise<unknown>
 * }} input
 * @returns {{
 *   completeNonRetriableFailure:(job:{id:string},error:string)=>Promise<void>,
 *   finalizeJobRun:(input:{job:object,runResult:object,metrics:{processed:number,succeeded:number,failed:number,retried:number}})=>Promise<void>,
 *   normalizeRunResult:(runResult:object|null|undefined)=>{exitCode:number,executionMode:'daemon'|'subprocess',daemon:object|null,status:'done'|'failed'}
 * }}
 */
export const createJobCompletion = ({
  queueDir,
  resolvedQueueName,
  queueMaxRetries,
  completeJob
}) => {
  /**
   * Complete a job immediately with a non-retriable failure.
   *
   * @param {{id:string}} job
   * @param {string} error
   * @returns {Promise<void>}
   */
  const completeNonRetriableFailure = async (job, error) => {
    await completeJob(
      queueDir,
      job.id,
      'failed',
      {
        exitCode: 1,
        error,
        executionMode: 'subprocess'
      },
      resolvedQueueName
    );
  };

  /**
   * Finalize queue state transitions after one executed job, including retries.
   *
   * @param {{job:object,runResult:object,metrics:{processed:number,succeeded:number,failed:number,retried:number}}} input
   * @returns {Promise<void>}
   */
  const finalizeJobRun = async ({ job, runResult, metrics }) => {
    const normalized = normalizeRunResult(runResult);
    const attempts = Number.isFinite(job.attempts) ? job.attempts : 0;
    const maxRetries = Number.isFinite(job.maxRetries)
      ? job.maxRetries
      : (queueMaxRetries ?? 0);
    if (normalized.status === 'failed' && maxRetries > attempts) {
      const nextAttempts = attempts + 1;
      metrics.retried += 1;
      await completeJob(
        queueDir,
        job.id,
        'queued',
        {
          exitCode: normalized.exitCode,
          retry: true,
          attempts: nextAttempts,
          error: `exit ${normalized.exitCode}`,
          executionMode: normalized.executionMode,
          daemon: normalized.daemon
        },
        resolvedQueueName
      );
      return;
    }
    if (normalized.status === 'done') {
      metrics.succeeded += 1;
    } else {
      metrics.failed += 1;
    }
    await completeJob(
      queueDir,
      job.id,
      normalized.status,
      {
        exitCode: normalized.exitCode,
        error: `exit ${normalized.exitCode}`,
        executionMode: normalized.executionMode,
        daemon: normalized.daemon
      },
      resolvedQueueName
    );
  };

  return {
    completeNonRetriableFailure,
    finalizeJobRun,
    normalizeRunResult
  };
};
