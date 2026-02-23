import { coerceIntAtLeast } from '../../../shared/number-coerce.js';

const DEFAULT_FORCED_HEAVY_PATTERNS = [
  /(^|\/)field_postings(?:\.|$)/,
  /(^|\/)token_postings(?:\.|$)/,
  /(^|\/)chunk_meta(?:\.|$)/
];

const DEFAULT_FORCED_ULTRA_LIGHT_PATTERNS = [
  /(^|\/)\.filelists\.json$/,
  /(^|\/).*\.meta\.json$/,
  /(^|\/)determinism_report\.json$/,
  /(^|\/)vocab_order\.json$/,
  /(^|\/)pieces\/manifest\.json$/
];

const DEFAULT_FORCED_MASSIVE_PATTERNS = [
  /(^|\/)field_postings(?:\.|$)/,
  /(^|\/)field_postings\.binary-columnar(?:\.|$)/,
  /(^|\/)token_postings\.packed(?:\.|$)/,
  /(^|\/)token_postings\.binary-columnar(?:\.|$)/,
  /(^|\/)chunk_meta\.binary-columnar(?:\.|$)/
];

const resolvePatternList = (rawPatterns, fallbackPatterns) => (
  Array.isArray(rawPatterns)
    ? rawPatterns
      .filter((entry) => typeof entry === 'string' && entry.trim())
      .map((entry) => new RegExp(entry))
    : fallbackPatterns
);

const resolveWorkClassOverride = (...values) => {
  for (const candidate of values) {
    const parsed = coerceIntAtLeast(candidate, 1);
    if (parsed != null) return parsed;
  }
  return null;
};

/**
 * Resolve artifact-write lane/dispatch tuning config from indexing artifact config.
 *
 * @param {{artifactConfig:object,writeFsStrategy:{tailWorker?:boolean}}} input
 * @returns {{heavyWriteThresholdBytes:number,forcedHeavyWritePatterns:RegExp[],ultraLightWriteThresholdBytes:number,forcedUltraLightWritePatterns:RegExp[],massiveWriteThresholdBytes:number,forcedMassiveWritePatterns:RegExp[],massiveWriteIoTokens:number,massiveWriteMemTokens:number,workClassSmallConcurrencyOverride:number|null,workClassMediumConcurrencyOverride:number|null,workClassLargeConcurrencyOverride:number|null,adaptiveWriteConcurrencyEnabled:boolean,adaptiveWriteMinConcurrency:number,adaptiveWriteStartConcurrencyOverride:number|null,adaptiveWriteScaleUpBacklogPerSlot:number,adaptiveWriteScaleDownBacklogPerSlot:number,adaptiveWriteStallScaleDownSeconds:number,adaptiveWriteStallScaleUpGuardSeconds:number,adaptiveWriteScaleUpCooldownMs:number,adaptiveWriteScaleDownCooldownMs:number,writeTailRescueEnabled:boolean,writeTailRescueMaxPending:number,writeTailRescueStallSeconds:number,writeTailRescueBoostIoTokens:number,writeTailRescueBoostMemTokens:number,writeTailWorkerEnabled:boolean,writeTailWorkerMaxPending:number}}
 */
export const resolveArtifactWriteDispatchConfig = ({ artifactConfig, writeFsStrategy }) => {
  const heavyWriteThresholdBytes = coerceIntAtLeast(
    artifactConfig.writeHeavyThresholdBytes,
    1024 * 1024
  ) ?? (16 * 1024 * 1024);

  const forcedHeavyWritePatterns = resolvePatternList(
    artifactConfig.writeHeavyLabelPatterns,
    DEFAULT_FORCED_HEAVY_PATTERNS
  );

  const ultraLightWriteThresholdBytes = coerceIntAtLeast(
    artifactConfig.writeUltraLightThresholdBytes,
    1024
  ) ?? (64 * 1024);

  const forcedUltraLightWritePatterns = resolvePatternList(
    artifactConfig.writeUltraLightLabelPatterns,
    DEFAULT_FORCED_ULTRA_LIGHT_PATTERNS
  );

  const massiveWriteThresholdBytes = coerceIntAtLeast(
    artifactConfig.writeMassiveThresholdBytes,
    8 * 1024 * 1024
  ) ?? (128 * 1024 * 1024);

  const forcedMassiveWritePatterns = resolvePatternList(
    artifactConfig.writeMassiveLabelPatterns,
    DEFAULT_FORCED_MASSIVE_PATTERNS
  );

  const massiveWriteIoTokens = coerceIntAtLeast(artifactConfig.writeMassiveIoTokens, 1) ?? 2;
  const massiveWriteMemTokens = coerceIntAtLeast(artifactConfig.writeMassiveMemTokens, 0) ?? 2;

  const workClassSmallConcurrencyOverride = resolveWorkClassOverride(
    artifactConfig.writeSmallConcurrency,
    artifactConfig.writeWorkClassSmallConcurrency
  );
  const workClassMediumConcurrencyOverride = resolveWorkClassOverride(
    artifactConfig.writeMediumConcurrency,
    artifactConfig.writeWorkClassMediumConcurrency,
    artifactConfig.writeHeavyConcurrency
  );
  const workClassLargeConcurrencyOverride = resolveWorkClassOverride(
    artifactConfig.writeLargeConcurrency,
    artifactConfig.writeWorkClassLargeConcurrency,
    artifactConfig.writeMassiveConcurrency
  );

  const adaptiveWriteConcurrencyEnabled = artifactConfig.writeAdaptiveConcurrency !== false;
  const adaptiveWriteMinConcurrency = Number.isFinite(Number(artifactConfig.writeAdaptiveMinConcurrency))
    ? Math.max(1, Math.floor(Number(artifactConfig.writeAdaptiveMinConcurrency)))
    : 1;
  const adaptiveWriteStartConcurrencyOverride = Number.isFinite(Number(artifactConfig.writeAdaptiveStartConcurrency))
    ? Math.max(1, Math.floor(Number(artifactConfig.writeAdaptiveStartConcurrency)))
    : null;
  const adaptiveWriteScaleUpBacklogPerSlot = Number.isFinite(
    Number(artifactConfig.writeAdaptiveScaleUpBacklogPerSlot)
  )
    ? Math.max(1, Number(artifactConfig.writeAdaptiveScaleUpBacklogPerSlot))
    : 1.75;
  const adaptiveWriteScaleDownBacklogPerSlot = Number.isFinite(
    Number(artifactConfig.writeAdaptiveScaleDownBacklogPerSlot)
  )
    ? Math.max(0, Number(artifactConfig.writeAdaptiveScaleDownBacklogPerSlot))
    : 0.5;
  const adaptiveWriteStallScaleDownSeconds = Number.isFinite(
    Number(artifactConfig.writeAdaptiveStallScaleDownSeconds)
  )
    ? Math.max(1, Math.floor(Number(artifactConfig.writeAdaptiveStallScaleDownSeconds)))
    : 20;
  const adaptiveWriteStallScaleUpGuardSeconds = Number.isFinite(
    Number(artifactConfig.writeAdaptiveStallScaleUpGuardSeconds)
  )
    ? Math.max(1, Math.floor(Number(artifactConfig.writeAdaptiveStallScaleUpGuardSeconds)))
    : 8;
  const adaptiveWriteScaleUpCooldownMs = Number.isFinite(
    Number(artifactConfig.writeAdaptiveScaleUpCooldownMs)
  )
    ? Math.max(0, Math.floor(Number(artifactConfig.writeAdaptiveScaleUpCooldownMs)))
    : 400;
  const adaptiveWriteScaleDownCooldownMs = Number.isFinite(
    Number(artifactConfig.writeAdaptiveScaleDownCooldownMs)
  )
    ? Math.max(0, Math.floor(Number(artifactConfig.writeAdaptiveScaleDownCooldownMs)))
    : 1200;

  const writeTailRescueEnabled = artifactConfig.writeTailRescue !== false;
  const writeTailRescueMaxPending = Number.isFinite(Number(artifactConfig.writeTailRescueMaxPending))
    ? Math.max(1, Math.floor(Number(artifactConfig.writeTailRescueMaxPending)))
    : 3;
  const writeTailRescueStallSeconds = Number.isFinite(Number(artifactConfig.writeTailRescueStallSeconds))
    ? Math.max(1, Math.floor(Number(artifactConfig.writeTailRescueStallSeconds)))
    : 15;
  const writeTailRescueBoostIoTokens = Number.isFinite(Number(artifactConfig.writeTailRescueBoostIoTokens))
    ? Math.max(0, Math.floor(Number(artifactConfig.writeTailRescueBoostIoTokens)))
    : 1;
  const writeTailRescueBoostMemTokens = Number.isFinite(Number(artifactConfig.writeTailRescueBoostMemTokens))
    ? Math.max(0, Math.floor(Number(artifactConfig.writeTailRescueBoostMemTokens)))
    : 1;

  const writeTailWorkerEnabled = writeFsStrategy.tailWorker;
  const writeTailWorkerMaxPending = Number.isFinite(Number(artifactConfig.writeTailWorkerMaxPending))
    ? Math.max(1, Math.floor(Number(artifactConfig.writeTailWorkerMaxPending)))
    : Math.max(2, writeTailRescueMaxPending + 1);

  return {
    heavyWriteThresholdBytes,
    forcedHeavyWritePatterns,
    ultraLightWriteThresholdBytes,
    forcedUltraLightWritePatterns,
    massiveWriteThresholdBytes,
    forcedMassiveWritePatterns,
    massiveWriteIoTokens,
    massiveWriteMemTokens,
    workClassSmallConcurrencyOverride,
    workClassMediumConcurrencyOverride,
    workClassLargeConcurrencyOverride,
    adaptiveWriteConcurrencyEnabled,
    adaptiveWriteMinConcurrency,
    adaptiveWriteStartConcurrencyOverride,
    adaptiveWriteScaleUpBacklogPerSlot,
    adaptiveWriteScaleDownBacklogPerSlot,
    adaptiveWriteStallScaleDownSeconds,
    adaptiveWriteStallScaleUpGuardSeconds,
    adaptiveWriteScaleUpCooldownMs,
    adaptiveWriteScaleDownCooldownMs,
    writeTailRescueEnabled,
    writeTailRescueMaxPending,
    writeTailRescueStallSeconds,
    writeTailRescueBoostIoTokens,
    writeTailRescueBoostMemTokens,
    writeTailWorkerEnabled,
    writeTailWorkerMaxPending
  };
};
