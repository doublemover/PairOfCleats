export const IMPORT_RESOLUTION_TRACE_STAGES = Object.freeze({
  EXTRACTION: 'extraction',
  NORMALIZATION: 'normalization',
  LANGUAGE_RESOLUTION: 'language_resolution',
  BUILD_SYSTEM_INTERPRETATION: 'build_system_interpretation',
  GENERATED_ARTIFACT_INTERPRETATION: 'generated_artifact_interpretation',
  FILESYSTEM_EXISTENCE: 'filesystem_existence',
  WORKSPACE_ANCHORING: 'workspace_anchoring',
  CLASSIFY: 'classify'
});

const normalizeStage = (value) => (
  typeof value === 'string' && value.trim()
    ? value.trim()
    : null
);

const normalizeOutcome = (value) => (
  typeof value === 'string' && value.trim()
    ? value.trim()
    : null
);

const cloneDetails = (value) => {
  if (!value || typeof value !== 'object') return null;
  return JSON.parse(JSON.stringify(value));
};

export const createImportResolutionTrace = ({ importer = '', rawSpecifier = '' } = {}) => {
  const stages = [];

  const record = ({
    stage,
    outcome,
    adapter = null,
    reasonCode = null,
    details = null
  } = {}) => {
    const normalizedStage = normalizeStage(stage);
    const normalizedOutcome = normalizeOutcome(outcome);
    if (!normalizedStage || !normalizedOutcome) return;
    stages.push({
      stage: normalizedStage,
      outcome: normalizedOutcome,
      adapter: typeof adapter === 'string' && adapter.trim() ? adapter.trim() : null,
      reasonCode: typeof reasonCode === 'string' && reasonCode.trim() ? reasonCode.trim() : null,
      importer: typeof importer === 'string' && importer.trim() ? importer.trim() : null,
      rawSpecifier: typeof rawSpecifier === 'string' && rawSpecifier.trim() ? rawSpecifier.trim() : null,
      details: cloneDetails(details)
    });
  };

  const snapshot = () => stages.map((entry) => ({
    ...entry,
    details: cloneDetails(entry.details)
  }));

  return Object.freeze({
    record,
    snapshot
  });
};
