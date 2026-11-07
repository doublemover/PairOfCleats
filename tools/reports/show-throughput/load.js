import { resolveRecordedMeasurementInputs } from '../../bench/language/metrics/recorded-evidence.js';
import fs from 'node:fs';

const NON_REPO_RESULTS_FOLDERS = new Set(['logs', 'usr']);

export const listDirs = (root) => fs.existsSync(root)
  ? fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  : [];

/**
 * Throughput aggregates are repo/language focused, so auxiliary benchmark
 * folders (for example USR guardrail snapshots) are excluded by default.
 *
 * @param {string} folderName
 * @param {{includeUsrGuardrails:boolean}} options
 * @returns {boolean}
 */
export const includeResultsFolder = (
  folderName,
  { includeUsrGuardrails = false } = {}
) => {
  if (folderName === 'usr' && includeUsrGuardrails) return true;
  return !NON_REPO_RESULTS_FOLDERS.has(folderName);
};

export const listResultFolders = (
  resultsRoot,
  { includeUsrGuardrails = false } = {}
) => listDirs(resultsRoot)
  .filter((dir) => includeResultsFolder(dir.name, { includeUsrGuardrails }))
  .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')));

export const loadJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

/** Historical reports never inherit the mutable repo/cache metrics loader. */
export const loadFeatureMetricsForPayload = (payload, { sourceRoot = null } = {}) => (
  resolveRecordedMeasurementInputs({ payload, sourceRoot }).featureMetrics
);
