export const fileAnalysisProtocolError = reason => Object.assign(new Error(`File analysis contract rejected ${reason}.`), {
  code: 'ERR_FILE_ANALYSIS_PROTOCOL', reason
});
export const fileAnalysisBudgetError = reason => Object.assign(new Error(`File analysis projection exceeds ${reason}.`), {
  code: 'ERR_FILE_ANALYSIS_BUDGET', reason
});
