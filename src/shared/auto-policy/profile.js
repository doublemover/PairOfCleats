import os from 'node:os';

const QUALITY_LEVELS = ['fast', 'balanced', 'max'];

export const CANONICAL_HUGE_REPO_PROFILE_ID = 'huge-repo';
export const CANONICAL_HUGE_REPO_OVERRIDES = Object.freeze({
  hugeRepoProfile: { enabled: true, id: CANONICAL_HUGE_REPO_PROFILE_ID },
  pipelineOverlap: {
    enabled: true,
    inferPostings: true
  },
  artifacts: {
    writeHeavyThresholdBytes: 64 * 1024 * 1024,
    writeMassiveThresholdBytes: 384 * 1024 * 1024,
    writeUltraLightThresholdBytes: 256 * 1024,
    fieldPostingsShardsEnabled: true,
    chunkMetaBinaryColumnar: true
  },
  scheduler: {
    adaptive: true,
    adaptiveTargetUtilization: 0.82,
    adaptiveStep: 2,
    queues: {
      'stage1.postings': { weight: 5, priority: 20 },
      'stage2.write': { weight: 5, priority: 20 },
      'stage2.relations': { weight: 3, priority: 30 },
      'stage4.sqlite': { weight: 5, priority: 20 },
      'embeddings.compute': { weight: 2, priority: 35 },
      'embeddings.io': { weight: 2, priority: 30 }
    }
  },
  typeInferenceCrossFile: false,
  riskAnalysisCrossFile: false,
  riskInterprocedural: {
    enabled: false
  },
  lexicon: {
    relations: {
      enabled: false
    }
  },
  documentExtraction: {
    enabled: false
  },
  commentExtraction: {
    enabled: false
  },
  records: {
    enabled: false
  }
});

const clonePlain = (value) => JSON.parse(JSON.stringify(value));

export const clampQuality = (value) => {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'auto') return 'auto';
  return QUALITY_LEVELS.includes(normalized) ? normalized : null;
};

const downgradeQuality = (quality) => {
  if (quality === 'max') return 'balanced';
  if (quality === 'balanced') return 'fast';
  return quality;
};

export const resolveQuality = ({ requested, resources, repo }) => {
  if (requested && requested !== 'auto') {
    return { value: requested, source: 'config' };
  }
  const cpu = resources.cpuCount;
  const memGb = resources.memoryGb;
  let value = 'max';
  if (memGb < 16 || cpu <= 4) value = 'fast';
  else if (memGb < 32 || cpu < 12) value = 'balanced';
  if (repo.huge) value = downgradeQuality(value);
  return { value, source: 'auto' };
};

export const summarizeResources = () => {
  const cpuCount = os.cpus().length;
  const memoryGb = Math.round((os.totalmem() / (1024 ** 3)) * 10) / 10;
  return { cpuCount, memoryGb };
};

export const formatBytes = (bytes) => {
  const total = Number(bytes);
  if (!Number.isFinite(total) || total <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = total;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
};

export const resolveHugeRepoProfile = ({ config = {}, repo = null }) => {
  const raw = config?.hugeRepoProfile;
  const profileConfig = raw && typeof raw === 'object' ? raw : {};
  const enabled = typeof profileConfig.enabled === 'boolean'
    ? profileConfig.enabled
    : repo?.huge === true;
  const id = enabled ? CANONICAL_HUGE_REPO_PROFILE_ID : 'default';
  const reason = enabled
    ? (repo?.huge === true ? 'repo-size-threshold' : 'explicit-config')
    : 'disabled';
  const overrides = enabled
    ? clonePlain(CANONICAL_HUGE_REPO_OVERRIDES)
    : {};
  return {
    id,
    enabled,
    reason,
    overrides
  };
};
