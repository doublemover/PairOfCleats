import { isPlainObject, mergeConfig } from '../../../shared/config.js';
import {
  isKnownIndexBuildStage,
  normalizeIndexBuildStage
} from '../../../shared/indexing/stages.js';

export const normalizeStage = normalizeIndexBuildStage;

export const buildStageOverrides = (twoStageConfig, stage) => {
  if (!isKnownIndexBuildStage(stage)) return null;
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
