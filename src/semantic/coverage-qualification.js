/**
 * One lookup represents a source-related scope, including its sibling physical
 * syntax/analysis partitions. Retain only bounded failure facts across pages;
 * raw coverage rows remain page-local and retain their physical provenance.
 */
export const createSemanticCoverageQualification = () => ({
  observed: false,
  missingSyntax: false,
  missingAnalysis: false,
  incompleteSyntax: false,
  incompleteAnalysis: false
});

export const qualifySemanticCoverage = (previous, rows) => {
  const syntax = rows.filter(row => row.phase === 'syntax');
  const analysis = rows.filter(row => row.phase !== 'syntax');
  return {
    observed: true,
    missingSyntax: previous.missingSyntax || syntax.length === 0,
    missingAnalysis: previous.missingAnalysis || analysis.length === 0,
    incompleteSyntax: previous.incompleteSyntax || syntax.some(row => row.state !== 'complete'),
    incompleteAnalysis: previous.incompleteAnalysis || analysis.some(row => row.state !== 'complete')
  };
};

export const semanticCoverageIsComplete = qualification => qualification.observed
  && !qualification.missingSyntax && !qualification.missingAnalysis
  && !qualification.incompleteSyntax && !qualification.incompleteAnalysis;

export const semanticCoverageWarning = qualification => {
  const reasons = [
    !qualification.observed && 'no selected coverage scope',
    qualification.missingSyntax && 'missing syntax',
    qualification.missingAnalysis && 'missing analysis',
    qualification.incompleteSyntax && 'incomplete syntax',
    qualification.incompleteAnalysis && 'incomplete analysis'
  ].filter(Boolean);
  return reasons.length
    ? 'Source analysis coverage remains incomplete across this request: ' + reasons.join(', ') + '.'
    : null;
};
