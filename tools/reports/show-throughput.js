#!/usr/bin/env node
import { listResultFolders } from './show-throughput/load.js';
import {
  resolveShowThroughputOptions,
  validateResultsRoot
} from './show-throughput/options.js';
import { loadThroughputReportFolders } from './show-throughput/load-report-data.js';
import { aggregateThroughputReport } from './show-throughput/aggregate-report.js';
import { renderThroughputReport } from './show-throughput/render-report.js';

/**
 * Aggregate benchmark throughput JSON results into folder-level and global
 * throughput/latency/indexing summaries for quick regression triage.
 */
const options = resolveShowThroughputOptions({
  argv: process.argv.slice(2),
  cwd: process.cwd()
});

if (!validateResultsRoot(options.resultsRoot)) {
  console.error(`No benchmark results found at ${options.resultsRoot}`);
  process.exit(1);
}

const folders = listResultFolders(options.resultsRoot, {
  includeUsrGuardrails: options.includeUsrGuardrails
});
if (!folders.length) {
  console.error('No benchmark results folders found.');
  process.exit(0);
}

const loadedFolders = loadThroughputReportFolders({
  resultsRoot: options.resultsRoot,
  folders,
  refreshJson: options.refreshJson,
  deepAnalysis: options.deepAnalysis
});
const report = aggregateThroughputReport(loadedFolders);
renderThroughputReport({ report, options });
