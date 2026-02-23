export const ORDERING_LEDGER_SCHEMA_VERSION = 1;

const isRecord = (value) => (
  Boolean(value) && typeof value === 'object'
);

export const normalizeOrderingLedger = (ledger) => {
  if (!isRecord(ledger)) return null;
  const version = Number.isFinite(Number(ledger.schemaVersion))
    ? Number(ledger.schemaVersion)
    : 0;
  let next = {
    schemaVersion: version || ORDERING_LEDGER_SCHEMA_VERSION,
    seeds: isRecord(ledger.seeds) ? { ...ledger.seeds } : {},
    stages: isRecord(ledger.stages) ? { ...ledger.stages } : {}
  };
  if (version && version > ORDERING_LEDGER_SCHEMA_VERSION) {
    return { ...next, schemaVersion: version };
  }
  if (version && version !== ORDERING_LEDGER_SCHEMA_VERSION) {
    next = {
      ...next,
      schemaVersion: ORDERING_LEDGER_SCHEMA_VERSION
    };
  }
  return next;
};

export const mergeOrderingLedger = (base, patch) => {
  if (!patch) return base || null;
  const normalizedBase = normalizeOrderingLedger(base) || {
    schemaVersion: ORDERING_LEDGER_SCHEMA_VERSION,
    seeds: {},
    stages: {}
  };
  const normalizedPatch = normalizeOrderingLedger(patch) || {
    schemaVersion: ORDERING_LEDGER_SCHEMA_VERSION,
    seeds: {},
    stages: {}
  };
  const next = {
    schemaVersion: ORDERING_LEDGER_SCHEMA_VERSION,
    seeds: { ...(normalizedBase.seeds || {}), ...(normalizedPatch.seeds || {}) },
    stages: { ...(normalizedBase.stages || {}) }
  };
  for (const [stage, value] of Object.entries(normalizedPatch.stages || {})) {
    if (!value || typeof value !== 'object') {
      next.stages[stage] = value;
      continue;
    }
    const baseStage = normalizedBase.stages?.[stage];
    const mergedStage = {
      ...(baseStage && typeof baseStage === 'object' ? baseStage : {}),
      ...value
    };
    if (value.seeds && typeof value.seeds === 'object') {
      mergedStage.seeds = {
        ...(baseStage?.seeds && typeof baseStage.seeds === 'object' ? baseStage.seeds : {}),
        ...value.seeds
      };
    }
    if (value.artifacts && typeof value.artifacts === 'object') {
      mergedStage.artifacts = {
        ...(baseStage?.artifacts && typeof baseStage.artifacts === 'object' ? baseStage.artifacts : {}),
        ...value.artifacts
      };
    }
    next.stages[stage] = mergedStage;
  }
  return next;
};

export const normalizeSeedInputs = (inputs = {}) => ({
  discoveryHash: typeof inputs.discoveryHash === 'string' ? inputs.discoveryHash : null,
  fileListHash: typeof inputs.fileListHash === 'string' ? inputs.fileListHash : null,
  fileCount: Number.isFinite(inputs.fileCount) ? inputs.fileCount : null,
  mode: typeof inputs.mode === 'string' ? inputs.mode : null
});

export const resolveStageKey = (stage, mode) => {
  if (!stage) return null;
  const stageKey = String(stage);
  return mode ? `${stageKey}:${mode}` : stageKey;
};

export const validateOrderingLedgerShape = (ledger) => {
  const normalized = normalizeOrderingLedger(ledger);
  if (!normalized) return { ok: false, errors: ['orderingLedger missing'] };
  const errors = [];
  if (!Number.isFinite(Number(normalized.schemaVersion))) {
    errors.push('orderingLedger.schemaVersion missing');
  }
  if (!normalized.stages || typeof normalized.stages !== 'object') {
    errors.push('orderingLedger.stages missing');
  }
  return { ok: errors.length === 0, errors, value: normalized };
};
