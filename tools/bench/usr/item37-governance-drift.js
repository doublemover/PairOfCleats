#!/usr/bin/env node
import {
  ensureArray,
  hashInputs,
  parseBenchArgs,
  readJsonFileWithRaw,
  readJsonFromRoot,
  readTextFromRoot,
  repoPath,
  writeBenchJson
} from './shared.js';

const CONFIG_PATH = repoPath('docs', 'config', 'usr-guardrails', 'item-37-governance-drift.json');

const main = async () => {
  const argv = parseBenchArgs();
  const { json: config, raw: configRaw } = await readJsonFileWithRaw(CONFIG_PATH);

  const ownership = await readJsonFromRoot(config.inputs.ownershipMatrix);
  const governanceSpec = await readTextFromRoot(config.inputs.governanceSpec);
  const coverageMatrix = await readTextFromRoot(config.inputs.coverageMatrix);

  const rows = ensureArray(ownership.json.rows);
  const blockingRows = rows.filter(
    (row) => row && typeof row === 'object' && !Array.isArray(row) && row.blocking === true
  );

  const report = {
    section: config.section,
    item: config.item,
    generatedAt: new Date().toISOString(),
    metrics: {
      ownershipRows: rows.length,
      blockingOwnershipRows: blockingRows.length,
      governanceSpecBytes: governanceSpec.length,
      coverageMatrixBytes: coverageMatrix.length,
      requiredReferenceCount: ensureArray(config.requiredGovernanceReferences).length
    },
    sourceDigest: hashInputs([configRaw, ownership.raw, governanceSpec, coverageMatrix])
  };

  if (!argv.quiet) {
    console.log(
      `[bench] usr-item37 ownership=${report.metrics.ownershipRows} `
      + `blocking=${report.metrics.blockingOwnershipRows} refs=${report.metrics.requiredReferenceCount}`
    );
    console.log(JSON.stringify(report, null, 2));
  }

  await writeBenchJson(argv.json, report);
};

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
