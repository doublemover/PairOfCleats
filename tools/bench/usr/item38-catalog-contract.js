#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CONFIG_PATH = path.join(ROOT, 'docs', 'config', 'usr-guardrails', 'item-38-catalog-contract.json');

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
const isObjectRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const countMalformedRows = (rows) => rows.reduce((count, row) => (isObjectRecord(row) ? count : count + 1), 0);

const hashInputs = (inputs) => {
  const h = crypto.createHash('sha256');
  for (const value of inputs) {
    const chunk = String(value);
    h.update(String(chunk.length));
    h.update(':');
    h.update(chunk);
    h.update('|');
  }
  return h.digest('hex');
};

const main = async () => {
  const argv = parseArgs();
  const configRaw = await fs.readFile(CONFIG_PATH, 'utf8');
  const config = JSON.parse(configRaw);

  const languageProfiles = await readJson(config.inputs.languageProfiles);
  const frameworkProfiles = await readJson(config.inputs.frameworkProfiles);
  const edgeCases = await readJson(config.inputs.frameworkEdgeCases);
  const capabilityMatrix = await readJson(config.inputs.capabilityMatrix);
  const versionPolicy = await readJson(config.inputs.languageVersionPolicy);
  const embeddingPolicy = await readJson(config.inputs.languageEmbeddingPolicy);

  const languageRows = ensureArray(languageProfiles.json.rows);
  const frameworkRows = ensureArray(frameworkProfiles.json.rows);
  const edgeCaseRows = ensureArray(edgeCases.json.rows);
  const capabilityRows = ensureArray(capabilityMatrix.json.rows);
  const versionRows = ensureArray(versionPolicy.json.rows);
  const embeddingRows = ensureArray(embeddingPolicy.json.rows);

  const report = {
    section: config.section,
    item: config.item,
    title: config.title,
    generatedAt: new Date().toISOString(),
    metrics: {
      languageProfiles: languageRows.length,
      frameworkProfiles: frameworkRows.length,
      frameworkEdgeCases: edgeCaseRows.length,
      capabilityRows: capabilityRows.length,
      versionRows: versionRows.length,
      embeddingRows: embeddingRows.length
    },
    malformedRows: {
      languageProfiles: countMalformedRows(languageRows),
      frameworkProfiles: countMalformedRows(frameworkRows),
      frameworkEdgeCases: countMalformedRows(edgeCaseRows),
      capabilityRows: countMalformedRows(capabilityRows),
      versionRows: countMalformedRows(versionRows),
      embeddingRows: countMalformedRows(embeddingRows)
    },
    sourceDigest: hashInputs([
      configRaw,
      languageProfiles.raw,
      frameworkProfiles.raw,
      edgeCases.raw,
      capabilityMatrix.raw,
      versionPolicy.raw,
      embeddingPolicy.raw
    ])
  };

  if (!argv.quiet) {
    console.log(
      `[bench] usr-item38 langs=${report.metrics.languageProfiles} `
      + `frameworks=${report.metrics.frameworkProfiles} edgeCases=${report.metrics.frameworkEdgeCases}`
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
