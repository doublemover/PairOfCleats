import { createHash } from 'node:crypto';
import { evaluateVectorOracles } from '../../src/retrieval/evaluation/vector-oracle.js';

/** Saved raw-stage replay joins the existing report, not the live search's
 * relevance aggregates. A new search is not evidence for a saved ANN candidate
 * list, even when the query text happens to match. */
export const evaluateDatasetVectorReplay = async ({ entry, query, topN, signal = null }) => {
  if (entry?.vectorEvaluation == null) return null;
  const records = Array.isArray(entry.vectorEvaluation) ? entry.vectorEvaluation : [entry.vectorEvaluation];
  if (!records.length || records.length > 4) throw new Error('Evaluation permits at most four independently qualified vector replay records per query.');
  const textDigest = createHash('sha256').update(query).digest('hex'), receipts = [];
  for (const record of records) {
    if (record?.query?.textDigest !== textDigest) throw new Error('Saved vector oracle query digest does not match this evaluation case.');
    receipts.push(await evaluateVectorOracles(record, { k: topN, signal }));
  }
  return { kind: 'saved-stage-replay', currentSearchEvidence: false, aggregation: 'separate-from-live-judged-metrics',
    complete: receipts.every(receipt => receipt.complete), receipts };
};
