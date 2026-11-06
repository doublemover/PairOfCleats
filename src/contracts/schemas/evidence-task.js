import { semanticObject as object } from './semantic-envelopes.js';
import { QUESTION_WORLD_SCHEMA, QUESTION_SOURCE_REFERENCE_SCHEMA } from './repository-question.js';
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const text = maxLength => ({ type: 'string', minLength: 1, maxLength });
const list = (items, maxItems, minItems = 0) => ({ type: 'array', items, maxItems, minItems, uniqueItems: true });
const timestamp = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const group = object({ id: text(64), require: { type: 'integer', minimum: 1, maximum: 32 }, unitIds: list(hash, 32, 1) });
const uint = maximum => ({ type: 'integer', minimum: 0, maximum });
const ms = { type: 'number', minimum: 0 };
const coverage = { enum: ['complete-in-declared-universe', 'partial', 'unknown'] };
const baselineMethod = { enum: ['lexical-visible-prefix-v1', 'source-order-files-v1', 'always-abstain-v1'] };
const compileWork = object({ executionId: hash, sourceBytes: uint(4194304), sourceFiles: uint(128), oracleUnits: uint(128), elapsedMs: ms });
const splitWork = object({ executionId: hash, sourceBytes: uint(16777216), compiledTasks: uint(64), leakageComponents: uint(64),
  sourceIdentityReuse: { const: 'compiler-owned-digests; no-text-rehash' }, elapsedMs: ms });
const selectedAlternative = object({ id: text(64), groups: list(object({ id: text(64), required: { type: 'integer', minimum: 1, maximum: 32 },
  coveredUnitIds: list(hash, 32) }), 32, 1), satisfied: { type: 'boolean' }, satisfiedGroups: uint(32) });
export const EVIDENCE_TASK_VERSION = 1;
export const EVIDENCE_TASK_SCHEMAS = {
  outcome: object({ schemaVersion: { const: EVIDENCE_TASK_VERSION }, kind: { const: 'finite-evidence-task-outcome' }, taskSpecId: hash,
    publicTaskId: hash, splitManifestId: hash, privateOracleId: hash, candidateId: hash, runId: hash, outputHash: hash,
    candidateContentId: hash, semanticOutcomeId: hash, receiptId: hash,
    executionStatus: { enum: ['completed', 'invalid-fixture', 'unsupported', 'not-run', 'timeout', 'canceled', 'tool-error'] },
    taskResult: { enum: ['pass', 'fail', 'unknown'] }, reason: { enum: ['oracle-coverage-or-validation-unavailable', 'quarantined-compiled-task',
      'candidate-submission-not-completed', 'invalid-source-evidence', 'declared-evidence-budget-exceeded', 'explicit-verified-empty-oracle',
      'one-explicit-sufficient-alternative-complete', 'closed-declared-oracle-has-no-complete-alternative'] },
    taskOutcomeMeaning: { const: 'finite-source-evidence-certificate-only' }, executedCandidateProgram: { const: false },
    axes: object({ sourceValidity: { enum: ['matches-compiled-visible-snapshot', 'invalid'] }, labelCoverage: coverage,
      evidenceGroups: { enum: ['one-declared-alternative-complete', 'incomplete-or-unknown'] }, observedReadOrUse: { const: 'not-established' },
      semanticClosure: { const: 'not-implied' }, downstreamOutcome: { const: 'not-assessed' } }),
    evidence: object({ submittedSpans: uint(32), uniqueSourceUnits: uint(32), unionSourceBytes: uint(4194304), withinDeclaredBudget: { type: 'boolean' },
      analysisState: { enum: ['declared-oracle-evaluated', 'not-evaluated-incomplete-run-or-fixture'] },
      rejected: list(object({ index: uint(31), reason: { const: 'source-identity-or-original-utf16-span-mismatch' } }), 32), coveredOracleUnits: uint(128),
      alternatives: list(object({ id: text(64), satisfied: { type: 'boolean' }, requiredGroups: uint(32), satisfiedGroups: uint(32) }), 32),
      selectedAlternative: { anyOf: [selectedAlternative, { type: 'null' }] }, selection: { const: 'one-complete-or-best-partial-declared-alternative' } }),
    qualification: object({ sourceAuthority: { const: 'compiled-author-snapshot-not-live-reader' },
      oracleAdmission: { const: 'supplied-status-and-receipt-ids-not-independently-revalidated' },
      oracleAuthority: { enum: ['authored', 'externally-reviewed', 'unverified'] }, split: { enum: ['train', 'dev', 'calibration', 'test', null] },
      nearDuplicateAudit: { const: 'unchecked' }, trainingContamination: { const: 'not-established' } }),
    work: object({ executionId: hash, compilation: compileWork, split: splitWork, scoringMs: ms,
      setupAccounting: { const: 'reference-original-execution-ids-once; fresh-score-work-every-call' },
      rssBytes: { type: 'null' }, rssReason: { const: 'not-measured' }, buildOrModelExecution: { const: 'not-requested' } }) }),
  compilation: object({ schemaVersion: { const: EVIDENCE_TASK_VERSION },
    spec: object({ profile: { const: 'finite-source-evidence-v1' }, problem: text(8192), publicTaskKey: hash, worldRef: QUESTION_WORLD_SCHEMA,
      languageProfile: text(128), environmentId: hash, dependencyLockId: hash,
      cutoffAt: timestamp, taskAvailableAt: timestamp, historyRegime: { enum: ['declared-base-only', 'declared-history-permitted'] },
      allowedActions: list({ enum: ['inspect-visible-source', 'search-visible-source'] }, 2, 1),
      limits: object({ maxEvidenceSpans: { type: 'integer', minimum: 1, maximum: 32 },
        maxSelectedSourceBytes: { type: 'integer', minimum: 1, maximum: 1048576 } }) }),
    sourceSnapshot: { type: 'array', minItems: 1, maxItems: 128, items: object({ path: text(4096),
      language: text(128), text: { type: 'string', maxLength: 131072 }, availableAt: timestamp,
      role: { enum: ['source', 'readme'] } }) },
    lineage: object({ repositoryFamilyId: hash, cloneFamilyIds: list(hash, 32), issueFixFamilyIds: list(hash, 32),
      trajectoryFamilyIds: list(hash, 32), sourceOriginIds: list(hash, 32), synthesisAncestorIds: list(hash, 32) }),
    privateOracle: object({ profile: { const: 'authored-source-interval-coverage-v1' },
      availableAt: timestamp,
      labelCoverage: coverage,
      validation: object({ status: { enum: ['authored', 'externally-reviewed', 'unverified'] }, receiptIds: list(hash, 32) }),
      units: list(object({ id: hash, source: QUESTION_SOURCE_REFERENCE_SCHEMA }), 128),
      alternatives: list(object({ id: text(64), groups: list(group, 32, 1) }), 32),
      noLocalAnswer: { enum: ['verified-in-supplied-model', 'unknown', 'not-applicable'] } }) }),
  split: object({ schemaVersion: { const: EVIDENCE_TASK_VERSION }, seed: text(256),
    train: { type: 'integer', minimum: 0, maximum: 10000 }, dev: { type: 'integer', minimum: 0, maximum: 10000 },
    calibration: { type: 'integer', minimum: 0, maximum: 10000 }, test: { type: 'integer', minimum: 0, maximum: 10000 } }),
  submission: object({ schemaVersion: { const: EVIDENCE_TASK_VERSION }, publicTaskId: hash,
    candidateId: hash, runId: hash, status: { enum: ['completed', 'not-run', 'timeout', 'canceled', 'tool-error'] },
    evidence: list(QUESTION_SOURCE_REFERENCE_SCHEMA, 32), abstain: { type: 'boolean' } }),
  baseline: object({ schemaVersion: { const: EVIDENCE_TASK_VERSION }, method: baselineMethod,
    runId: hash, maxReadBytes: { type: 'integer', minimum: 1, maximum: 1048576 },
    maxSelectedFiles: { type: 'integer', minimum: 1, maximum: 32 }, maxSelectedSourceBytes: { type: 'integer', minimum: 1, maximum: 1048576 },
    maxWorkMs: { type: 'integer', minimum: 1, maximum: 250 } }),
  quality: object({ schemaVersion: { const: EVIDENCE_TASK_VERSION }, baselineMethod, candidateMethod: baselineMethod,
    seed: text(256), resamples: { type: 'integer', minimum: 32, maximum: 2048 },
    limits: object({}, { inputBytes: { type: 'integer', minimum: 1, maximum: 8388608 }, outputBytes: { type: 'integer', minimum: 256, maximum: 1048576 },
      work: { type: 'integer', minimum: 1, maximum: 2097152 }, maxMs: { type: 'integer', minimum: 1, maximum: 1000 } }) })
};
