#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CONFIG_PATH = path.join(ROOT, 'docs', 'config', 'usr-guardrails', 'item-37-governance-drift.json');

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

const readText = async (relativePath) => {
  const absolutePath = path.join(ROOT, relativePath);
  const raw = await fs.readFile(absolutePath, 'utf8');
  return raw;
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

  const ownership = await readJson(config.inputs.ownershipMatrix);
  const governanceSpec = await readText(config.inputs.governanceSpec);
  const coverageMatrix = await readText(config.inputs.coverageMatrix);

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
