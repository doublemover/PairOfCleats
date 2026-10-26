import { classifyThroughputInput } from './result-contract.js';
const normalize = value => String(value || '').trim().toLowerCase();
export const matchesRepoFilter = (run, value) => {
  const filter = normalize(value);
  return !filter || [run.repoIdentity, run.repoHistoryKey, run.file].some(candidate => normalize(candidate).includes(filter));
};
export const compareReportRunTime = (left, right) => {
  const time = row => Number.isFinite(row.generatedAtMs) ? row.generatedAtMs : -Infinity;
  if (time(left) !== time(right)) return time(left) < time(right) ? -1 : 1;
  return String(left.file).localeCompare(String(right.file));
};
/** Latest N is per folder, after repository admission. Missing dates sort first;
 * equal/missing dates use the stable source filename as their tie breaker. */
export const selectThroughputRunInputs = (rows, { repoFilter = null, latestCount = null } = {}) => {
  const selected = rows.filter(row => (row.inputKind === 'supported-run' || classifyThroughputInput(row.payload) === 'supported-run') && matchesRepoFilter(row, repoFilter)).sort(compareReportRunTime);
  return latestCount ? selected.slice(-latestCount) : selected;
};
