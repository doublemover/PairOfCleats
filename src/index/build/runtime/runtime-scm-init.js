import { getScmProvider, getScmProviderAndRoot } from '../../scm/registry.js';
import { setScmRuntimeConfig } from '../../scm/runtime.js';

/**
 * Resolve SCM provider selection and repository provenance.
 *
 * Sequencing contract:
 * - Invoke after `resolveScmConfig()` and before build-root resolution so
 *   `scmHeadId` can seed deterministic build IDs.
 * - If provenance probing fails, force provider=`none` for the active runtime
 *   to avoid mixed policy/runtime behavior.
 *
 * @param {{
 *   argv:object,
 *   root:string,
 *   scmConfig:object,
 *   log:(line:string)=>void,
 *   timeInit:(label:string,loader:()=>Promise<unknown>)=>Promise<unknown>
 * }} input
 * @returns {Promise<{scmSelection:object,repoProvenance:object,scmHeadId:string|null}>}
 */
export const resolveRuntimeScmSelection = async ({
  argv,
  root,
  scmConfig,
  log,
  timeInit
}) => {
  const scmProviderOverride = typeof argv['scm-provider'] === 'string'
    ? argv['scm-provider']
    : (typeof argv.scmProvider === 'string' ? argv.scmProvider : null);
  const scmProviderSetting = scmProviderOverride || scmConfig?.provider || 'auto';
  let scmSelection = getScmProviderAndRoot({
    provider: scmProviderSetting,
    startPath: root,
    log
  });
  if (scmSelection.provider === 'none') {
    log('[scm] provider=none; SCM provenance unavailable.');
  }
  let scmProvenanceFailed = false;
  const repoProvenance = await timeInit('repo provenance', async () => {
    try {
      const provenance = await scmSelection.providerImpl.getRepoProvenance({
        repoRoot: scmSelection.repoRoot
      });
      return {
        ...provenance,
        provider: provenance?.provider || scmSelection.provider,
        root: provenance?.root || scmSelection.repoRoot,
        detectedBy: provenance?.detectedBy ?? scmSelection.detectedBy
      };
    } catch (err) {
      const message = err?.message || String(err);
      log(`[scm] Failed to read repo provenance; falling back to provider=none. (${message})`);
      scmProvenanceFailed = true;
      return {
        provider: 'none',
        root: scmSelection.repoRoot,
        head: null,
        dirty: null,
        detectedBy: scmSelection.detectedBy || 'none',
        isRepo: false
      };
    }
  });
  if (scmProvenanceFailed && scmSelection.provider !== 'none') {
    log('[scm] disabling provider after provenance failure; falling back to provider=none.');
    scmSelection = {
      ...scmSelection,
      provider: 'none',
      providerImpl: getScmProvider('none'),
      detectedBy: scmSelection.detectedBy || 'none'
    };
  }
  const scmHeadId = repoProvenance?.head?.changeId
    || repoProvenance?.head?.commitId
    || repoProvenance?.commit
    || null;
  return {
    scmSelection,
    repoProvenance,
    scmHeadId
  };
};

/**
 * Publish resolved SCM runtime config with concurrency defaults.
 *
 * Sequencing contract:
 * - Run after envelope concurrency resolution so fallback fanout uses active
 *   runtime limits.
 * - Run after provenance resolution so `repoHeadId` and `repoProvenance` are
 *   always synchronized with provider fallback state.
 *
 * @param {{
 *   scmConfig:object,
 *   scmHeadId:string|null,
 *   repoProvenance:object,
 *   cpuCount:number,
 *   maxConcurrencyCap:number,
 *   fileConcurrency:number,
 *   ioConcurrency:number,
 *   cpuConcurrency:number
 * }} input
 * @returns {number}
 */
export const configureScmRuntimeConcurrency = ({
  scmConfig,
  scmHeadId,
  repoProvenance,
  cpuCount,
  maxConcurrencyCap,
  fileConcurrency,
  ioConcurrency,
  cpuConcurrency
}) => {
  const normalizedScmMaxConcurrentProcesses = Number.isFinite(Number(scmConfig?.maxConcurrentProcesses))
    ? Math.max(1, Math.floor(Number(scmConfig.maxConcurrentProcesses)))
    : Math.max(
      1,
      Math.floor(
        cpuConcurrency
        || fileConcurrency
        || ioConcurrency
        || 1
      )
    );
  setScmRuntimeConfig({
    ...scmConfig,
    repoHeadId: scmHeadId || null,
    repoProvenance,
    maxConcurrentProcesses: normalizedScmMaxConcurrentProcesses,
    runtime: {
      cpuCount,
      maxConcurrencyCap,
      fileConcurrency,
      ioConcurrency,
      cpuConcurrency
    }
  });
  return normalizedScmMaxConcurrentProcesses;
};
