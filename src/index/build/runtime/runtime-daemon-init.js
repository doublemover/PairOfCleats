import { warmEmbeddingAdapter } from '../../../shared/embedding-adapter.js';
import {
  acquireRuntimeDaemonSession,
  addDaemonEmbeddingWarmKey,
  hasDaemonEmbeddingWarmKey
} from './daemon-session.js';

/**
 * Resolve daemon config/session state from runtime inputs.
 *
 * Sequencing contract:
 * - Call after profile selection so daemon session keys include the effective
 *   runtime profile.
 * - Call before envelope await so daemon metadata logging is emitted in the
 *   same startup phase as other init-state logs.
 *
 * @param {{
 *   argv:object,
 *   envConfig:object,
 *   indexingConfig:object,
 *   profileId:string,
 *   cacheRoot:string,
 *   root:string,
 *   log:(line:string)=>void
 * }} input
 * @returns {{daemonConfig:object,daemonSession:object|null}}
 */
export const resolveRuntimeDaemonSession = ({
  argv,
  envConfig,
  indexingConfig,
  profileId,
  cacheRoot,
  root,
  log
}) => {
  const daemonConfig = indexingConfig?.daemon && typeof indexingConfig.daemon === 'object'
    ? indexingConfig.daemon
    : {};
  const daemonEnabledFromArg = argv.daemon === true || argv.daemonEnabled === true;
  const daemonSessionKeyFromArg = typeof argv.daemonSessionKey === 'string'
    ? argv.daemonSessionKey.trim()
    : '';
  const daemonDeterministicArg = typeof argv.daemonDeterministic === 'boolean'
    ? argv.daemonDeterministic
    : null;
  const daemonHealthArg = argv.daemonHealth && typeof argv.daemonHealth === 'object'
    ? argv.daemonHealth
    : null;
  const daemonEnabled = daemonEnabledFromArg
    || daemonConfig.enabled === true
    || envConfig.indexDaemon === true;
  const daemonDeterministic = daemonDeterministicArg === null
    ? daemonConfig.deterministic !== false
    : daemonDeterministicArg !== false;
  const daemonHealthConfig = daemonHealthArg || (
    daemonConfig.health && typeof daemonConfig.health === 'object'
      ? daemonConfig.health
      : null
  );
  const daemonSession = acquireRuntimeDaemonSession({
    enabled: daemonEnabled,
    sessionKey: daemonSessionKeyFromArg || daemonConfig.sessionKey || envConfig.indexDaemonSession || null,
    cacheRoot,
    repoRoot: root,
    deterministic: daemonDeterministic,
    profile: profileId,
    health: daemonHealthConfig
  });
  if (daemonSession) {
    log(`[init] daemon session: ${daemonSession.key} (jobs=${daemonSession.jobsProcessed}, deterministic=${daemonSession.deterministic !== false}).`);
  }
  return {
    daemonConfig,
    daemonSession
  };
};

/**
 * Prewarm embedding adapter once per daemon generation/provider tuple.
 *
 * Sequencing contract:
 * - Run after embedding runtime resolution so provider/model identity is final.
 * - Run before worker pool creation so first embedding tasks can avoid startup
 *   model load penalty when daemon mode is active.
 *
 * @param {{
 *   daemonSession:object|null,
 *   daemonConfig:object,
 *   embeddingEnabled:boolean,
 *   useStubEmbeddings:boolean,
 *   embeddingProvider:string|null,
 *   modelId:string|null,
 *   modelsDir:string|null,
 *   embeddingNormalize:boolean,
 *   embeddingOnnx:object,
 *   root:string,
 *   timeInit:(label:string,loader:()=>Promise<unknown>)=>Promise<unknown>
 * }} input
 * @returns {Promise<{daemonPrewarmEmbeddings:boolean,daemonEmbeddingWarmHit:boolean,embeddingWarmKey:string}>}
 */
export const prewarmRuntimeDaemonEmbeddings = async ({
  daemonSession,
  daemonConfig,
  embeddingEnabled,
  useStubEmbeddings,
  embeddingProvider,
  modelId,
  modelsDir,
  embeddingNormalize,
  embeddingOnnx,
  root,
  timeInit
}) => {
  const daemonPrewarmEmbeddings = daemonConfig.prewarmEmbeddings !== false;
  const embeddingWarmKey = `${embeddingProvider || 'unknown'}:${modelId || 'none'}:${modelsDir || 'none'}:${embeddingNormalize !== false}`;
  const daemonEmbeddingWarmHit = daemonSession
    ? hasDaemonEmbeddingWarmKey(daemonSession, embeddingWarmKey)
    : false;
  if (
    daemonSession
    && daemonPrewarmEmbeddings
    && embeddingEnabled
    && useStubEmbeddings !== true
    && !daemonEmbeddingWarmHit
  ) {
    await timeInit('embedding prewarm', () => warmEmbeddingAdapter({
      rootDir: root,
      provider: embeddingProvider,
      onnxConfig: embeddingOnnx,
      normalize: embeddingNormalize,
      useStub: false,
      modelId,
      modelsDir
    }));
    addDaemonEmbeddingWarmKey(daemonSession, embeddingWarmKey);
  }
  return {
    daemonPrewarmEmbeddings,
    daemonEmbeddingWarmHit,
    embeddingWarmKey
  };
};

/**
 * Build daemon snapshot payload exposed from runtime object.
 *
 * @param {{daemonSession:object|null,daemonJobContext:object|null}} input
 * @returns {object}
 */
export const buildRuntimeDaemonState = ({ daemonSession, daemonJobContext }) => (
  daemonSession
    ? {
      enabled: true,
      sessionKey: daemonSession.key,
      deterministic: daemonSession.deterministic !== false,
      jobContext: daemonJobContext,
      generation: daemonSession.generation || 1,
      generationJobsProcessed: daemonSession.generationJobsProcessed || 0,
      jobsProcessed: daemonSession.jobsProcessed,
      recycle: {
        count: daemonSession.recycleCount || 0,
        lastAt: daemonSession.lastRecycleAt || null,
        lastReasons: daemonSession.lastRecycleReasons || []
      },
      warmCaches: {
        dictionaries: daemonSession.dictCache?.size || 0,
        treeSitterPreload: daemonSession.treeSitterPreloadCache?.size || 0,
        embeddings: daemonSession.embeddingWarmKeys?.size || 0
      }
    }
    : {
      enabled: false,
      sessionKey: null,
      deterministic: true,
      jobContext: null,
      jobsProcessed: 0,
      warmCaches: {
        dictionaries: 0,
        treeSitterPreload: 0,
        embeddings: 0
      }
    }
);
