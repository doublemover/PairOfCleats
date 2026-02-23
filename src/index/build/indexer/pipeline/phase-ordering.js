const resolvePipelineOverlapConfig = (runtime) => (
  runtime?.indexingConfig?.pipelineOverlap
  && typeof runtime.indexingConfig.pipelineOverlap === 'object'
    ? runtime.indexingConfig.pipelineOverlap
    : {}
);

const shouldPrepareIncrementalBundleVfsRows = ({
  mode,
  crossFileInferenceEnabled,
  runtime
}) => (
  mode === 'code'
  && crossFileInferenceEnabled
  && runtime?.incrementalEnabled === true
);

/**
 * Start prefetch work for incremental bundle VFS rows when cross-file inference
 * is policy-enabled for this mode.
 *
 * @param {{
 *  mode:string,
 *  crossFileInferenceEnabled:boolean,
 *  runtime:object,
 *  incrementalState:object,
 *  prepareIncrementalBundleVfsRows:(input:object)=>Promise<object|null>
 * }} input
 * @returns {Promise<object|null>|null}
 */
export const createIncrementalBundleVfsRowsPromise = ({
  mode,
  crossFileInferenceEnabled,
  runtime,
  incrementalState,
  prepareIncrementalBundleVfsRows
}) => (
  shouldPrepareIncrementalBundleVfsRows({
    mode,
    crossFileInferenceEnabled,
    runtime
  })
    ? prepareIncrementalBundleVfsRows({
      runtime,
      incrementalState,
      enabled: true
    })
    : null
);

/**
 * Resolve whether postings can overlap relations for this mode.
 *
 * @param {{mode:string,runtime:object,crossFileInferenceEnabled:boolean}} input
 * @returns {boolean}
 */
export const resolvePostingsOverlapPolicy = ({
  mode,
  runtime,
  crossFileInferenceEnabled
}) => {
  const overlapConfig = resolvePipelineOverlapConfig(runtime);
  return mode === 'code'
    && overlapConfig.enabled !== false
    && overlapConfig.inferPostings !== false
    && crossFileInferenceEnabled;
};

/**
 * Optionally start postings before relations and return the in-flight promise.
 *
 * Ordering contract:
 * The caller must still await this promise at the postings stage before write.
 *
 * @param {{overlapInferPostings:boolean,runPostingsBuild:()=>Promise<object>}} input
 * @returns {Promise<object>|null}
 */
export const startOverlappedPostingsBuild = ({
  overlapInferPostings,
  runPostingsBuild
}) => {
  if (!overlapInferPostings) return null;
  const postingsPromise = runPostingsBuild();
  // Avoid transient unhandled-rejection noise before the awaited join point.
  postingsPromise.catch(() => {});
  return postingsPromise;
};

/**
 * Resolve prefetched incremental VFS rows only after relations confirms
 * cross-file inference actually executed.
 *
 * @param {{
 *  mode:string,
 *  crossFileEnabled:boolean,
 *  incrementalBundleVfsRowsPromise:Promise<object|null>|null
 * }} input
 * @returns {Promise<object|null>}
 */
export const resolveExistingIncrementalBundleRows = async ({
  mode,
  crossFileEnabled,
  incrementalBundleVfsRowsPromise
}) => (
  mode === 'code' && crossFileEnabled && incrementalBundleVfsRowsPromise
    ? await incrementalBundleVfsRowsPromise
    : null
);
