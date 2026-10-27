import {
  hashDeterministicIterable
} from '../../shared/invariants.js';
import { createGraphRelationsIterator } from '../build/artifacts/helpers.js';
import { addIssue } from './issues.js';

const hashOrderingRows = (
  rows,
  { encodeLine = (row) => JSON.stringify(row) } = {}
) => {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  // Validate against the exact ordering-line representation emitted by writers.
  return hashDeterministicIterable(rows, { encodeLine });
};

const hashGraphRelationsRows = (relations) => {
  if (!relations || typeof relations !== 'object') return null;
  const iterator = createGraphRelationsIterator(relations)();
  return hashDeterministicIterable(iterator, {
    encodeLine: (row) => JSON.stringify(row)
  });
};

const resolveLedgerStageKey = (ledger, stage, mode) => {
  if (!ledger?.stages || typeof ledger.stages !== 'object') return null;
  const stageKey = stage ? String(stage) : null;
  const modeKey = stageKey && mode ? `${stageKey}:${mode}` : null;
  if (modeKey && ledger.stages[modeKey]) return modeKey;
  if (stageKey && ledger.stages[stageKey]) return stageKey;
  if (stageKey) return null;
  if (mode) {
    const match = Object.keys(ledger.stages).find((key) => key.endsWith(`:${mode}`));
    if (match) return match;
  }
  const keys = Object.keys(ledger.stages);
  return keys.length ? keys[0] : null;
};

const recordOrderingDrift = ({
  report,
  modeReport,
  mode,
  stageKey,
  artifact,
  expected,
  actual,
  strict,
  source = null
}) => {
  const expectedHash = expected?.hash || null;
  const actualHash = actual?.hash || null;
  const rule = expected?.rule || null;
  const issueLabel = `ordering ledger mismatch for ${artifact}`;
  const detail = `${issueLabel} (expected ${expectedHash ?? 'null'}, got ${actualHash ?? 'null'})`;
  const drift = {
    stage: stageKey,
    mode,
    artifact,
    rule,
    expectedHash,
    actualHash,
    source
  };
  report.orderingDrift.push(drift);
  if (strict) {
    modeReport.ok = false;
    modeReport.missing.push(detail);
    addIssue(report, mode, detail, null, 'issues', { artifact, code: 'ERR_INDEX_ORDERING_MISMATCH' });
  } else {
    modeReport.warnings.push(issueLabel);
    addIssue(report, mode, detail, null, 'warnings', { artifact, modeMessage: issueLabel, code: 'WARN_INDEX_ORDERING_MISMATCH' });
  }
  report.hints.push('Rebuild ordering ledger by re-running index build.');
};

export const validateOrderingLedger = ({
  orderingLedger,
  orderingStrict,
  report,
  modeReport,
  mode,
  indexState,
  chunkMeta,
  relations,
  repoMap,
  graphRelations,
  vocabHashes
}) => {
  if (!orderingLedger) {
    const detail = 'ordering ledger unavailable for selected generation';
    if (orderingStrict) {
      modeReport.ok = false;
      modeReport.missing.push(detail);
      addIssue(report, mode, detail, null, 'issues', { state: 'missing', artifact: 'ordering_ledger', code: 'ERR_INDEX_ORDERING_LEDGER_MISSING' });
    }
    return;
  }
  const stageKey = resolveLedgerStageKey(orderingLedger, indexState?.stage || 'stage2', mode);
  const ledgerStage = stageKey ? orderingLedger.stages?.[stageKey] : null;
  if (!ledgerStage || !ledgerStage.artifacts) {
    const warning = `ordering ledger missing stage ${stageKey || 'unknown'}`;
    if (orderingStrict) {
      modeReport.ok = false;
      modeReport.missing.push(warning);
      addIssue(report, mode, warning, null, 'issues', { state: 'missing', artifact: 'ordering_ledger', code: 'ERR_INDEX_ORDERING_STAGE_MISSING' });
    } else {
      modeReport.warnings.push('ordering ledger stage missing');
      addIssue(report, mode, warning, null, 'warnings', { state: 'unverified', artifact: 'ordering_ledger', code: 'WARN_INDEX_ORDERING_STAGE_UNVERIFIED' });
    }
    return;
  }

  const actualHashes = {
    chunk_meta: hashOrderingRows(chunkMeta),
    file_relations: relations ? hashOrderingRows(relations) : null,
    repo_map: repoMap ? hashOrderingRows(repoMap) : null,
    graph_relations: graphRelations ? hashGraphRelationsRows(graphRelations) : null,
    token_vocab: vocabHashes?.token || null,
    phrase_ngrams: vocabHashes?.phrase || null,
    chargram_postings: vocabHashes?.chargram || null
  };
  for (const [artifact, expected] of Object.entries(ledgerStage.artifacts)) {
    const actual = actualHashes[artifact] || null;
    if (!actual) {
      recordOrderingDrift({
        report,
        modeReport,
        mode,
        stageKey,
        artifact,
        expected,
        actual,
        strict: orderingStrict,
        source: 'missing-artifact'
      });
      continue;
    }
    if (expected?.hash && expected.hash !== actual.hash) {
      recordOrderingDrift({
        report,
        modeReport,
        mode,
        stageKey,
        artifact,
        expected,
        actual,
        strict: orderingStrict,
        source: 'hash-mismatch'
      });
    }
  }
};
