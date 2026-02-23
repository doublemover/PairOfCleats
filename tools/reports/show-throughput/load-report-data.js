import fs from 'node:fs';
import path from 'node:path';
import { loadJson, loadFeatureMetricsForPayload } from './load.js';
import {
  loadOrComputeIndexingSummary,
  loadOrComputeBenchAnalysis,
  resolveRepoIdentity,
  loadOrComputeThroughputLedger
} from './analysis.js';

/**
 * @typedef {object} ThroughputRunRecord
 * @property {string} file
 * @property {object|null} summary
 * @property {object} throughput
 * @property {object|null} featureMetrics
 * @property {object|null} analysis
 * @property {object|null} indexingSummary
 * @property {object|null} throughputLedger
 * @property {string} repoIdentity
 * @property {string|null} repoMetricsKey
 * @property {number|null} generatedAtMs
 */

const resolveRepoMetricsKey = (payload) => (
  payload?.repo?.root
  || payload?.artifacts?.repo?.root
  || payload?.artifacts?.repo?.cacheRoot
  || null
);

const parseGeneratedAtMs = (payload) => {
  const generatedAtMs = Date.parse(payload?.generatedAt || payload?.summary?.generatedAt || '');
  return Number.isFinite(generatedAtMs) ? generatedAtMs : null;
};

/**
 * Load and enrich every benchmark payload in one folder.
 *
 * @param {{
 *   folderPath:string,
 *   refreshJson?:boolean,
 *   deepAnalysis?:boolean
 * }} input
 * @returns {ThroughputRunRecord[]}
 */
export const loadFolderRunRecords = ({
  folderPath,
  refreshJson = false,
  deepAnalysis = false
}) => {
  const files = fs.readdirSync(folderPath)
    .filter((name) => name.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right));
  /** @type {ThroughputRunRecord[]} */
  const runs = [];

  for (const file of files) {
    const resultPath = path.join(folderPath, file);
    const payload = loadJson(resultPath);
    if (!payload) continue;
    const summary = payload.summary || payload.runs?.[0] || null;
    const throughput = payload.artifacts?.throughput || {};
    let dirty = false;
    const featureMetrics = loadFeatureMetricsForPayload(payload);
    const {
      indexingSummary,
      changed: indexingChanged,
      featureMetrics: resolvedFeatureMetrics
    } = loadOrComputeIndexingSummary({
      payload,
      featureMetrics,
      refreshJson
    });
    if (indexingChanged) dirty = true;
    const { analysis, changed: analysisChanged } = loadOrComputeBenchAnalysis({
      payload,
      featureMetrics: resolvedFeatureMetrics,
      indexingSummary,
      refreshJson,
      deepAnalysis
    });
    if (analysisChanged) dirty = true;
    const { throughputLedger, changed: throughputLedgerChanged } = loadOrComputeThroughputLedger({
      payload,
      indexingSummary
    });
    if (throughputLedgerChanged && refreshJson) dirty = true;
    if (dirty && refreshJson) {
      try {
        fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2));
      } catch {}
    }
    runs.push({
      file,
      summary,
      throughput,
      featureMetrics: resolvedFeatureMetrics || featureMetrics || null,
      analysis,
      indexingSummary,
      throughputLedger,
      repoIdentity: resolveRepoIdentity({ payload, file }),
      repoMetricsKey: resolveRepoMetricsKey(payload),
      generatedAtMs: parseGeneratedAtMs(payload)
    });
  }

  return runs;
};

/**
 * @param {{
 *   resultsRoot:string,
 *   folders:Array<{name:string}>,
 *   refreshJson?:boolean,
 *   deepAnalysis?:boolean
 * }} input
 * @returns {Array<{name:string,runs:ThroughputRunRecord[]}>}
 */
export const loadThroughputReportFolders = ({
  resultsRoot,
  folders,
  refreshJson = false,
  deepAnalysis = false
}) => folders.map((folder) => ({
  name: folder.name,
  runs: loadFolderRunRecords({
    folderPath: path.join(resultsRoot, folder.name),
    refreshJson,
    deepAnalysis
  })
}));
