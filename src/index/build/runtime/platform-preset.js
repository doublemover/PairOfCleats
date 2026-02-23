import fs from 'node:fs/promises';
import path from 'node:path';
import { mergeConfig } from '../../../shared/config.js';
import { resolveSubprocessFanoutPreset } from '../../../shared/subprocess.js';

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const INDEX_OPTIMIZATION_PROFILE_IDS = Object.freeze(['default', 'throughput', 'memory-saver']);

/**
 * Normalize index optimization profile id.
 *
 * @param {unknown} value
 * @returns {'default'|'throughput'|'memory-saver'}
 */
export const normalizeIndexOptimizationProfile = (value) => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return INDEX_OPTIMIZATION_PROFILE_IDS.includes(normalized) ? normalized : 'default';
};

/**
 * Apply learned auto-profile overrides when marked as applied.
 *
 * @param {{indexingConfig?:object,learnedAutoProfile?:object|null}} [input]
 * @returns {object}
 */
export const applyLearnedAutoProfileSelection = ({
  indexingConfig = {},
  learnedAutoProfile = null
} = {}) => {
  if (!isObject(indexingConfig)) return {};
  if (!isObject(learnedAutoProfile)) return indexingConfig;
  if (learnedAutoProfile.applied !== true) return indexingConfig;
  if (!isObject(learnedAutoProfile.overrides)) return indexingConfig;
  return mergeConfig(indexingConfig, learnedAutoProfile.overrides);
};

/**
 * Resolve platform/filesystem runtime preset and suggested overrides.
 *
 * @param {{platform?:string,filesystemProfile?:string,cpuCount?:number,indexingConfig?:object}} [input]
 * @returns {{enabled:boolean,presetId:string,filesystemProfile:string,subprocessFanout:object,overrides:object|null}}
 */
export const resolvePlatformRuntimePreset = ({
  platform = process.platform,
  filesystemProfile = 'unknown',
  cpuCount = 1,
  indexingConfig = {}
} = {}) => {
  const presetsConfig = indexingConfig?.platformPresets && typeof indexingConfig.platformPresets === 'object'
    ? indexingConfig.platformPresets
    : {};
  if (presetsConfig.enabled === false) {
    return {
      enabled: false,
      presetId: 'disabled',
      filesystemProfile,
      subprocessFanout: resolveSubprocessFanoutPreset({ platform, cpuCount, filesystemProfile }),
      overrides: null
    };
  }
  const artifactsConfig = indexingConfig?.artifacts && typeof indexingConfig.artifacts === 'object'
    ? indexingConfig.artifacts
    : {};
  const scmConfig = indexingConfig?.scm && typeof indexingConfig.scm === 'object'
    ? indexingConfig.scm
    : {};
  const subprocessFanout = resolveSubprocessFanoutPreset({ platform, cpuCount, filesystemProfile });
  const overrides = {};
  if (typeof artifactsConfig.writeFsStrategy !== 'string' || !artifactsConfig.writeFsStrategy.trim()) {
    overrides.artifacts = {
      writeFsStrategy: filesystemProfile === 'ntfs' ? 'ntfs' : 'generic'
    };
  }
  if (!Number.isFinite(Number(scmConfig.maxConcurrentProcesses)) || Number(scmConfig.maxConcurrentProcesses) <= 0) {
    overrides.scm = {
      maxConcurrentProcesses: subprocessFanout.maxParallelismHint
    };
  }
  if (platform === 'win32') {
    const schedulerConfig = indexingConfig?.scheduler && typeof indexingConfig.scheduler === 'object'
      ? indexingConfig.scheduler
      : {};
    if (!schedulerConfig?.writeBackpressure || typeof schedulerConfig.writeBackpressure !== 'object') {
      overrides.scheduler = {
        writeBackpressure: {
          pendingBytesThreshold: 384 * 1024 * 1024,
          oldestWaitMsThreshold: 12000
        }
      };
    }
  }
  return {
    enabled: true,
    presetId: `${platform}:${filesystemProfile}`,
    filesystemProfile,
    subprocessFanout,
    overrides: Object.keys(overrides).length ? overrides : null
  };
};

/**
 * Run tiny startup I/O probe used by runtime auto-tuning heuristics.
 *
 * @param {{cacheRoot?:string,enabled?:boolean}} [input]
 * @returns {Promise<object>}
 */
export const runStartupCalibrationProbe = async ({
  cacheRoot,
  enabled = true
} = {}) => {
  if (!enabled || !cacheRoot) {
    return {
      enabled: false,
      probeBytes: 0,
      writeReadMs: 0,
      cleanupMs: 0
    };
  }
  const probeDir = path.join(cacheRoot, 'runtime-calibration');
  const probePath = path.join(probeDir, `probe-${process.pid}.tmp`);
  const probeBytes = 8 * 1024;
  const payload = Buffer.alloc(probeBytes, 97);
  const writeReadStart = Date.now();
  try {
    await fs.mkdir(probeDir, { recursive: true });
    await fs.writeFile(probePath, payload);
    await fs.readFile(probePath);
  } catch (err) {
    return {
      enabled: true,
      probeBytes,
      writeReadMs: Math.max(0, Date.now() - writeReadStart),
      cleanupMs: 0,
      error: err?.message || String(err)
    };
  }
  const writeReadMs = Math.max(0, Date.now() - writeReadStart);
  const cleanupStart = Date.now();
  try {
    await fs.unlink(probePath);
  } catch {}
  const cleanupMs = Math.max(0, Date.now() - cleanupStart);
  return {
    enabled: true,
    probeBytes,
    writeReadMs,
    cleanupMs
  };
};
