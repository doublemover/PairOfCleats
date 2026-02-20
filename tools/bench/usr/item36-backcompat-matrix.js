#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CONFIG_PATH = path.join(ROOT, 'docs', 'config', 'usr-guardrails', 'item-36-backcompat-matrix.json');

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = { json: '', quiet: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') {
      out.json = args[i + 1] || '';
      i += 1;
      continue;
    }
    if (arg === '--quiet') {
      out.quiet = true;
    }
  }
  return out;
};

const readJson = async (relativePath) => {
  const absolutePath = path.join(ROOT, relativePath);
  const raw = await fs.readFile(absolutePath, 'utf8');
  return { json: JSON.parse(raw), raw };
};

const ensureArray = (value) => (Array.isArray(value) ? value : []);

const hashInputs = (inputs) => {
  const h = crypto.createHash('sha256');
  for (const value of inputs) {
    h.update(value);
  }
  return h.digest('hex');
};

const main = async () => {
  const argv = parseArgs();
  const configRaw = await fs.readFile(CONFIG_PATH, 'utf8');
  const config = JSON.parse(configRaw);
  const matrix = await readJson(config.inputs.backcompatMatrix);

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

  if (argv.json) {
    const outPath = path.resolve(argv.json);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
};

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
