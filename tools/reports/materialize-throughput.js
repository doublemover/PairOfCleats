#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { color } from '../../src/retrieval/cli/ansi.js';
import {
  listResultFolders,
  loadJson,
  loadFeatureMetricsForPayload
} from './show-throughput/load.js';
import {
  resolveThroughputMaterializeOptions,
  validateResultsRoot
} from './show-throughput/options.js';
import {
  materializeIndexingSummary,
  materializeBenchAnalysis,
  materializeThroughputLedger,
  resolveRepoIdentity
} from './show-throughput/analysis.js';

const {
  resultsRoot,
  deepAnalysis,
  verboseOutput,
  includeUsrGuardrails
} = resolveThroughputMaterializeOptions({
  argv: process.argv.slice(2),
  cwd: process.cwd()
});

if (!validateResultsRoot(resultsRoot)) {
  console.error(`No benchmark results found at ${resultsRoot}`);
  process.exit(1);
}

const folders = listResultFolders(resultsRoot, { includeUsrGuardrails });
if (!folders.length) {
  console.error('No benchmark results folders found.');
  process.exit(0);
}

let changedFiles = 0;
const changedSections = {
  indexing: 0,
  analysis: 0,
  throughputLedger: 0
};
const writeFailures = [];

console.error(color.bold(color.cyan('Materialize Throughput Artifacts')));
console.error(color.gray(`Root: ${resultsRoot}`));
console.error(color.gray(`Deep analysis: ${deepAnalysis ? 'enabled' : 'disabled'}`));

for (const dir of folders) {
  const folderPath = path.join(resultsRoot, dir.name);
  const files = fs.readdirSync(folderPath)
    .filter((name) => name.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right));

  for (const file of files) {
    const resultPath = path.join(folderPath, file);
    const payload = loadJson(resultPath);
    if (!payload) continue;
    const featureMetrics = loadFeatureMetricsForPayload(payload);
    const indexingResult = materializeIndexingSummary({
      payload,
      featureMetrics
    });
    const analysisResult = materializeBenchAnalysis({
      payload,
      featureMetrics: indexingResult.featureMetrics,
      indexingSummary: indexingResult.indexingSummary,
      deepAnalysis
    });
    const throughputLedgerResult = materializeThroughputLedger({
      payload,
      indexingSummary: indexingResult.indexingSummary
    });

    const dirty = Boolean(indexingResult.changed || analysisResult.changed || throughputLedgerResult.changed);
    if (!dirty) continue;

    try {
      fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2));
      changedFiles += 1;
      if (indexingResult.changed) changedSections.indexing += 1;
      if (analysisResult.changed) changedSections.analysis += 1;
      if (throughputLedgerResult.changed) changedSections.throughputLedger += 1;
      if (verboseOutput) {
        console.error(
          `  wrote ${dir.name}/${file} (${resolveRepoIdentity({ payload, file })})` +
          ` | indexing ${indexingResult.changed ? 'yes' : 'no'}` +
          ` | analysis ${analysisResult.changed ? 'yes' : 'no'}` +
          ` | ledger ${throughputLedgerResult.changed ? 'yes' : 'no'}`
        );
      }
    } catch (err) {
      writeFailures.push({
        path: resultPath,
        message: err?.message || String(err)
      });
      console.error(color.yellow(`[warn] Failed to materialize benchmark JSON: ${resultPath} (${err?.message || err})`));
    }
  }
}

console.error('');
console.error(color.bold(color.green('Materialization Summary')));
console.error(`  files written: ${changedFiles}`);
console.error(`  indexing backfills: ${changedSections.indexing}`);
console.error(`  analysis backfills: ${changedSections.analysis}`);
console.error(`  throughput ledger backfills: ${changedSections.throughputLedger}`);

if (writeFailures.length) {
  process.exitCode = 1;
  console.error('');
  console.error(color.bold(color.yellow(`Write failures: ${writeFailures.length}`)));
  for (const entry of writeFailures.slice(0, 12)) {
    console.error(`  ${entry.path} :: ${entry.message}`);
  }
}
