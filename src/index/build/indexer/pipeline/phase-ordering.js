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
 * Resolve postings payload at the explicit stage-boundary join.
 *
 * Ordering contract:
 * If postings started during relations overlap, this join must happen before
 * write to ensure emitted artifacts read finalized postings data.
 *
 * @param {{
 *  postingsPromise:Promise<object>|null,
 *  runPostingsBuild:()=>Promise<object>
 * }} input
 * @returns {Promise<object>}
 */
export const resolvePostingsBuildResult = async ({
  postingsPromise,
  runPostingsBuild
}) => (
  postingsPromise
    ? await postingsPromise
    : await runPostingsBuild()
);

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

/**
 * Run write-stage artifacts first, then incremental bundle synchronization.
 *
 * Sequencing contract:
 * 1) `writeArtifacts` must complete before incremental bundle updates so
 *    bundle meta stays aligned with finalized chunk metadata.
 * 2) Prefetched VFS rows must only be consumed when relations confirmed
 *    cross-file inference actually ran for this mode.
 *
 * @param {{
 *  writeArtifacts:()=>Promise<void>,
 *  runtime:object,
 *  mode:string,
 *  crossFileEnabled:boolean,
 *  incrementalBundleVfsRowsPromise:Promise<object|null>|null,
 *  updateIncrementalBundles:(input:object)=>Promise<void>,
 *  incrementalState:object,
 *  state:object,
 *  log:(message:string)=>void
 * }} input
 * @returns {Promise<void>}
 */
export const runWriteStageWithIncrementalBundles = async ({
  writeArtifacts,
  runtime,
  mode,
  crossFileEnabled,
  incrementalBundleVfsRowsPromise,
  updateIncrementalBundles,
  incrementalState,
  state,
  log
}) => {
  await writeArtifacts();
  if (runtime?.incrementalEnabled !== true) return;
  const existingVfsManifestRowsByFile = await resolveExistingIncrementalBundleRows({
    mode,
    crossFileEnabled,
    incrementalBundleVfsRowsPromise
  });
  await updateIncrementalBundles({
    runtime,
    incrementalState,
    state,
    existingVfsManifestRowsByFile,
    log
  });
};
