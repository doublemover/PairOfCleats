export const buildAnalysisPolicy = ({
  toolingEnabled,
  typeInferenceEnabled,
  typeInferenceCrossFileEnabled,
  riskAnalysisEnabled,
  riskAnalysisCrossFileEnabled,
  riskInterproceduralEnabled,
  riskInterproceduralSummaryOnly,
  gitBlameEnabled
}) => ({
  metadata: { enabled: true },
  risk: {
    enabled: riskAnalysisEnabled,
    crossFile: riskAnalysisCrossFileEnabled,
    interprocedural: riskInterproceduralEnabled,
    interproceduralSummaryOnly: riskInterproceduralSummaryOnly
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
