import { snapshotPlainData } from '../../shared/plain-data-snapshot.js';

/** Machine identities use UTF-16 code-unit order, independent of host collation. */
export const compareEvaluationKeys = (left, right) => left < right ? -1 : left > right ? 1 : 0;

/** Evaluation snapshots accept inert, bounded JSON values and own them before
 * any cooperative yield. The allowance conservatively counts retained fields. */
export const snapshotEvaluationData = (input, options = {}) => snapshotPlainData(input, {
  ...options, label: 'Evaluation', code: options.code ?? 'ERR_EVALUATION_INPUT', nullPrototype: true
});
