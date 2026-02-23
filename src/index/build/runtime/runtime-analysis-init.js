import { normalizeRiskConfig } from '../../risk.js';
import { normalizeRiskInterproceduralConfig } from '../../risk-interprocedural/config.js';

/**
 * Resolve runtime analysis/risk feature flags and normalized risk configs.
 *
 * @param {{indexingConfig:object,rootDir:string}} input
 * @returns {{
 *   astDataflowEnabled:boolean,
 *   controlFlowEnabled:boolean,
 *   typeInferenceEnabled:boolean,
 *   typeInferenceCrossFileEnabled:boolean,
 *   riskAnalysisEnabled:boolean,
 *   riskAnalysisCrossFileEnabled:boolean,
 *   riskConfig:object,
 *   riskInterproceduralConfig:object,
 *   riskInterproceduralEnabled:boolean
 * }}
 */
export const resolveRuntimeAnalysisConfig = ({ indexingConfig, rootDir }) => {
  const astDataflowEnabled = indexingConfig.astDataflow !== false;
  const controlFlowEnabled = indexingConfig.controlFlow !== false;
  const typeInferenceEnabled = indexingConfig.typeInference !== false;
  const typeInferenceCrossFileEnabled = indexingConfig.typeInferenceCrossFile !== false;
  const riskAnalysisEnabled = indexingConfig.riskAnalysis !== false;
  const riskAnalysisCrossFileEnabled = riskAnalysisEnabled
    && indexingConfig.riskAnalysisCrossFile !== false;
  const riskConfig = normalizeRiskConfig({
    enabled: riskAnalysisEnabled,
    rules: indexingConfig.riskRules,
    caps: indexingConfig.riskCaps,
    regex: indexingConfig.riskRegex || indexingConfig.riskRules?.regex
  }, { rootDir });
  const riskInterproceduralConfig = normalizeRiskInterproceduralConfig(
    indexingConfig.riskInterprocedural,
    {}
  );
  const riskInterproceduralEnabled = riskAnalysisEnabled && riskInterproceduralConfig.enabled;
  return {
    astDataflowEnabled,
    controlFlowEnabled,
    typeInferenceEnabled,
    typeInferenceCrossFileEnabled,
    riskAnalysisEnabled,
    riskAnalysisCrossFileEnabled,
    riskConfig,
    riskInterproceduralConfig,
    riskInterproceduralEnabled
  };
};
