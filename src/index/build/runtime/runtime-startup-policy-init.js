import os from 'node:os';
import {
  getCacheRoot,
  getRepoCacheRoot
} from '../../../shared/dict-utils.js';
import { resolveCacheFilesystemProfile } from '../../../shared/cache-roots.js';
import { buildAutoPolicy } from '../../../shared/auto-policy.js';
import { mergeConfig } from '../../../shared/config.js';
import { setXxhashBackend } from '../../../shared/hash.js';
import {
  assertKnownIndexProfileId,
  buildIndexProfileState
} from '../../../contracts/index-profile.js';
import { resolveScmConfig } from '../../scm/registry.js';
import { resolveLearnedAutoProfileSelection } from './learned-auto-profile.js';
import {
  applyLearnedAutoProfileSelection,
  normalizeIndexOptimizationProfile,
  resolvePlatformRuntimePreset
} from './platform-preset.js';
import { applyAutoPolicyIndexingConfig, resolveBaseEmbeddingPlan } from './policy.js';
import { normalizeStage, buildStageOverrides } from './stage.js';

/**
 * Resolve startup policy assembly before envelope/bootstrap initialization.
 *
 * Sequencing contract:
 * - Apply auto-policy first, then capture `baseEmbeddingsPlanned` before
 *   stage/platform/learned overrides mutate embedding flags.
 * - Apply stage overrides before platform presets so stage-specific overrides
 *   can suppress preset fallback injections.
 * - Apply learned auto-profile overrides before profile normalization + SCM
 *   config assembly so downstream policy uses final indexing config.
 * - Apply CLI SCM annotate overrides before `resolveScmConfig()` so command
 *   line policy remains authoritative for this startup.
 *
 * @param {{
 *   root:string,
 *   argv:object,
 *   rawArgv:string[]|undefined,
 *   policy:object|null|undefined,
 *   userConfig:object,
 *   envConfig:object,
 *   log:(line:string)=>void,
 *   timeInit:(label:string,loader:()=>Promise<unknown>)=>Promise<unknown>
 * }} input
 * @returns {Promise<{
 *   policyConfig:object,
 *   autoPolicy:object|null,
 *   autoPolicyProvided:boolean,
 *   indexingConfig:object,
 *   autoPolicyProfile:object,
 *   hugeRepoProfileEnabled:boolean,
 *   baseEmbeddingsPlanned:boolean,
 *   stage:string|null,
 *   twoStageConfig:object,
 *   systemCpuCount:number,
 *   repoCacheRoot:string,
 *   cacheRoot:string,
 *   cacheRootSource:string,
 *   filesystemProfile:string,
 *   platformRuntimePreset:object,
 *   learnedAutoProfile:object,
 *   profile:object,
 *   indexOptimizationProfile:string,
 *   scmConfig:object
 * }>}
 */
export const resolveRuntimeStartupPolicyState = async ({
  root,
  argv,
  rawArgv,
  policy,
  userConfig,
  envConfig,
  log,
  timeInit
}) => {
  let indexingConfig = userConfig.indexing || {};
  const qualityOverride = typeof argv.quality === 'string' ? argv.quality.trim().toLowerCase() : '';
  const policyConfig = qualityOverride ? { ...userConfig, quality: qualityOverride } : userConfig;
  const autoPolicyProvided = policy != null;
  const autoPolicy = autoPolicyProvided
    ? policy
    : await timeInit('auto policy', () => buildAutoPolicy({ repoRoot: root, config: policyConfig }));
  const autoPolicyResolution = applyAutoPolicyIndexingConfig({
    indexingConfig,
    autoPolicy
  });
  indexingConfig = autoPolicyResolution.indexingConfig;
  const autoPolicyProfile = autoPolicyResolution.autoPolicyProfile;
  const hugeRepoProfileEnabled = autoPolicyResolution.hugeRepoProfileEnabled;
  const { baseEmbeddingsPlanned } = resolveBaseEmbeddingPlan(indexingConfig);

  const requestedHashBackend = typeof indexingConfig?.hash?.backend === 'string'
    ? indexingConfig.hash.backend.trim().toLowerCase()
    : '';
  if (requestedHashBackend && !envConfig.xxhashBackend) {
    setXxhashBackend(requestedHashBackend);
  }

  const stage = normalizeStage(argv.stage || envConfig.stage);
  const twoStageConfig = indexingConfig.twoStage || {};
  const stageOverrides = buildStageOverrides(twoStageConfig, stage);
  if (stageOverrides) {
    indexingConfig = mergeConfig(indexingConfig, stageOverrides);
  }

  const systemCpuCount = os.cpus().length;
  const repoCacheRoot = getRepoCacheRoot(root, userConfig);
  const cacheRoot = (userConfig.cache && userConfig.cache.root) || getCacheRoot();
  const cacheRootSource = userConfig.cache?.root
    ? 'config'
    : (envConfig.cacheRoot ? 'env' : 'default');
  const filesystemProfile = resolveCacheFilesystemProfile(cacheRoot, process.platform);
  const platformRuntimePreset = resolvePlatformRuntimePreset({
    platform: process.platform,
    filesystemProfile,
    cpuCount: systemCpuCount,
    indexingConfig
  });
  if (platformRuntimePreset?.overrides) {
    indexingConfig = mergeConfig(indexingConfig, platformRuntimePreset.overrides);
  }

  const learnedAutoProfile = await timeInit('learned auto profile', () => resolveLearnedAutoProfileSelection({
    root,
    repoCacheRoot,
    indexingConfig,
    log
  }));
  indexingConfig = applyLearnedAutoProfileSelection({
    indexingConfig,
    learnedAutoProfile
  });

  const profileId = assertKnownIndexProfileId(indexingConfig.profile);
  const profile = buildIndexProfileState(profileId);
  const indexOptimizationProfile = normalizeIndexOptimizationProfile(
    indexingConfig.indexOptimizationProfile
  );
  indexingConfig = {
    ...indexingConfig,
    profile: profile.id,
    indexOptimizationProfile
  };

  const runtimeArgs = Array.isArray(rawArgv) ? rawArgv : [];
  const scmAnnotateOverride = runtimeArgs.includes('--scm-annotate')
    ? true
    : (runtimeArgs.includes('--no-scm-annotate') ? false : null);
  if (scmAnnotateOverride != null) {
    indexingConfig = mergeConfig(indexingConfig, {
      scm: { annotate: { enabled: scmAnnotateOverride } }
    });
  }
  const scmConfig = resolveScmConfig({
    indexingConfig,
    analysisPolicy: userConfig.analysisPolicy || null,
    benchRun: envConfig.benchRun === true
  });

  return {
    policyConfig,
    autoPolicy,
    autoPolicyProvided,
    indexingConfig,
    autoPolicyProfile,
    hugeRepoProfileEnabled,
    baseEmbeddingsPlanned,
    stage,
    twoStageConfig,
    systemCpuCount,
    repoCacheRoot,
    cacheRoot,
    cacheRootSource,
    filesystemProfile,
    platformRuntimePreset,
    learnedAutoProfile,
    profile,
    indexOptimizationProfile,
    scmConfig
  };
};
