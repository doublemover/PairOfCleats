#!/usr/bin/env node
import {
  ensureArray,
  hashInputs,
  parseBenchArgs,
  readJsonFileWithRaw,
  readJsonFromRoot,
  repoPath,
  writeBenchJson
} from './shared.js';

const CONFIG_PATH = repoPath('docs', 'config', 'usr-guardrails', 'item-36-backcompat-matrix.json');

const main = async () => {
  const argv = parseBenchArgs();
  const { json: config, raw: configRaw } = await readJsonFileWithRaw(CONFIG_PATH);
  const matrix = await readJsonFromRoot(config.inputs.backcompatMatrix);

  const rows = ensureArray(matrix.json.rows);
  const requiredScenarioIds = ensureArray(config.requiredScenarioIds);
  const strictBlockingIds = ensureArray(config.strictBlockingIds);
  const nonStrictAdvisoryIds = ensureArray(config.nonStrictAdvisoryIds);
  const requiredScenarioSet = new Set(requiredScenarioIds);

  const strictRows = rows.filter((row) => row.readerMode === 'strict');
  const nonStrictRows = rows.filter((row) => row.readerMode === 'non-strict');
  const blockingRows = rows.filter((row) => row.blocking === true);
  const pairwiseExpandedRows = rows.filter(
    (row) => Array.isArray(row.readerVersions) && row.readerVersions.length > 1
  );
  const requiredScenarioRows = rows.filter((row) => requiredScenarioSet.has(row.id));

  const report = {
    section: config.section,
    item: config.item,
    generatedAt: new Date().toISOString(),
    metrics: {
      totalRows: rows.length,
      strictRows: strictRows.length,
      nonStrictRows: nonStrictRows.length,
      blockingRows: blockingRows.length,
      pairwiseExpandedRows: pairwiseExpandedRows.length,
      requiredScenarios: requiredScenarioIds.length,
      configuredStrictScenarios: strictBlockingIds.length,
      configuredAdvisoryScenarios: nonStrictAdvisoryIds.length,
      requiredScenarioRows: requiredScenarioRows.length
    },
    sourceDigest: hashInputs([configRaw, matrix.raw])
  };

  if (!argv.quiet) {
    console.log(
      `[bench] usr-item36 total=${report.metrics.totalRows} `
      + `strict=${report.metrics.strictRows} nonStrict=${report.metrics.nonStrictRows} blocking=${report.metrics.blockingRows}`
    );
    console.log(JSON.stringify(report, null, 2));
  }

  await writeBenchJson(argv.json, report);
};

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
