import { isPlainObject, mergeConfig } from '../../../shared/config.js';

export const normalizeStage = (raw) => {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!value) return null;
  if (value === '1' || value === 'stage1' || value === 'sparse') return 'stage1';
  if (value === '2' || value === 'stage2' || value === 'enrich' || value === 'full') return 'stage2';
  if (value === '3' || value === 'stage3' || value === 'embeddings' || value === 'embed') return 'stage3';
  if (value === '4' || value === 'stage4' || value === 'sqlite' || value === 'ann') return 'stage4';
  return null;
};

export const buildStageOverrides = (twoStageConfig, stage) => {
  if (!['stage1', 'stage2', 'stage3', 'stage4'].includes(stage)) return null;
  if (!isPlainObject(twoStageConfig)) return null;
  const defaults = stage === 'stage1'
    ? {
      embeddings: { enabled: false, mode: 'off' },
      treeSitter: { enabled: false },
      lint: false,
      complexity: false,
      riskAnalysis: false,
      riskAnalysisCrossFile: false,
      typeInference: false,
      typeInferenceCrossFile: false
    }
    : stage === 'stage2'
      ? {
        embeddings: { enabled: false, mode: 'off' }
      }
      : stage === 'stage3'
        ? {
          embeddings: { enabled: true, mode: 'auto' },
          treeSitter: { enabled: false },
          lint: false,
          complexity: false,
          riskAnalysis: false,
          riskAnalysisCrossFile: false,
          typeInference: false,
          typeInferenceCrossFile: false
        }
        : stage === 'stage4'
          ? {
            embeddings: { enabled: false, mode: 'off' },
            treeSitter: { enabled: false },
            lint: false,
            complexity: false,
            riskAnalysis: false,
            riskAnalysisCrossFile: false,
            typeInference: false,
            typeInferenceCrossFile: false
          }
          : {};
  const stageOverrides = stage === 'stage1'
    ? (isPlainObject(twoStageConfig.stage1) ? twoStageConfig.stage1 : {})
    : stage === 'stage2'
      ? (isPlainObject(twoStageConfig.stage2) ? twoStageConfig.stage2 : {})
      : stage === 'stage3'
        ? (isPlainObject(twoStageConfig.stage3) ? twoStageConfig.stage3 : {})
        : (isPlainObject(twoStageConfig.stage4) ? twoStageConfig.stage4 : {});
  return mergeConfig(defaults, stageOverrides);
};
