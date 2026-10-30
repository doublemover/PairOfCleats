#!/usr/bin/env node
import { guardBootstrapEntry } from '../../../src/shared/bootstrap-readiness.js';
await guardBootstrapEntry(import.meta.url);
import path from 'node:path';
import fs from 'node:fs/promises';
import { isDirectExecution } from '../../../src/shared/direct-execution.js';
const {
  ensureArray,
  hashInputs,
  USR_SOURCE_DIGEST_VERSION,
  USR_SOURCE_DIGEST_FORMAT,
  parseBenchArgs,
  readJsonFileWithRaw,
  ROOT,
  repoPath,
  writeBenchJson
} = await import('./shared.js');

const CONFIG_PATH = repoPath('docs', 'config', 'usr-guardrails', 'item-37-governance-drift.json');

export const createGovernanceDriftReport = async ({configPath=CONFIG_PATH,inputRoot=ROOT}={}) => {
  const { json: config, raw: configRaw } = await readJsonFileWithRaw(configPath);

  const ownership = await readJsonFileWithRaw(path.resolve(inputRoot,config.inputs.ownershipMatrix));
  const governanceSpec = await fs.readFile(path.resolve(inputRoot,config.inputs.governanceSpec),'utf8');
  const coverageMatrix = await fs.readFile(path.resolve(inputRoot,config.inputs.coverageMatrix),'utf8');

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
      governanceSpecBytes: Buffer.byteLength(governanceSpec,'utf8'),
      coverageMatrixBytes: Buffer.byteLength(coverageMatrix,'utf8'),
      requiredReferenceCount: ensureArray(config.requiredGovernanceReferences).length
    },
    sourceDigestVersion: USR_SOURCE_DIGEST_VERSION,
    sourceDigestFormat: USR_SOURCE_DIGEST_FORMAT,
    sourceDigest: hashInputs([
      {role:'config',path:path.relative(inputRoot,configPath).split(path.sep).join('/'),value:configRaw},
      {role:'ownershipMatrix',path:config.inputs.ownershipMatrix,value:ownership.raw},
      {role:'governanceSpec',path:config.inputs.governanceSpec,value:governanceSpec},
      {role:'coverageMatrix',path:config.inputs.coverageMatrix,value:coverageMatrix}
    ])
  };

  return report;
};

const main = async () => {
  const argv = parseBenchArgs(), report = await createGovernanceDriftReport();
  if (!argv.quiet) {
    console.log(
      `[bench] usr-item37 ownership=${report.metrics.ownershipRows} `
      + `blocking=${report.metrics.blockingOwnershipRows} refs=${report.metrics.requiredReferenceCount}`
    );
    console.log(JSON.stringify(report, null, 2));
  }

  await writeBenchJson(argv.json, report);
};

if (isDirectExecution(import.meta.url)) main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
