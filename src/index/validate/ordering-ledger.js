import {
  hashDeterministicIterable
} from '../../shared/invariants.js';
import { createGraphRelationsIterator } from '../build/artifacts/helpers.js';

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
  const note = `[${mode}] ${detail}`;
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
    report.issues.push(note);
  } else {
    modeReport.warnings.push(issueLabel);
    report.warnings.push(note);
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
  if (!orderingLedger) return;
  const stageKey = resolveLedgerStageKey(orderingLedger, indexState?.stage || 'stage2', mode);
  const ledgerStage = stageKey ? orderingLedger.stages?.[stageKey] : null;
  if (!ledgerStage || !ledgerStage.artifacts) {
    const warning = `[${mode}] ordering ledger missing stage ${stageKey || 'unknown'}`;
    if (orderingStrict) {
      modeReport.ok = false;
      modeReport.missing.push(warning);
      report.issues.push(warning);
    } else {
      modeReport.warnings.push('ordering ledger stage missing');
      report.warnings.push(warning);
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
