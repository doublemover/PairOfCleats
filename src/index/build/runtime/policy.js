export const buildAnalysisPolicy = ({
  toolingEnabled,
  typeInferenceEnabled,
  typeInferenceCrossFileEnabled,
  riskAnalysisEnabled,
  riskAnalysisCrossFileEnabled,
  gitBlameEnabled
}) => ({
  metadata: { enabled: true },
  risk: {
    enabled: riskAnalysisEnabled,
    crossFile: riskAnalysisCrossFileEnabled
  },
  git: {
    enabled: gitBlameEnabled,
    blame: gitBlameEnabled,
    churn: false
  },
  typeInference: {
    local: { enabled: typeInferenceEnabled },
    crossFile: { enabled: typeInferenceCrossFileEnabled },
    tooling: { enabled: typeInferenceCrossFileEnabled && toolingEnabled }
  }
});
