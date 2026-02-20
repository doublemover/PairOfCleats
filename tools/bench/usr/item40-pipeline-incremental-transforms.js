#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CONFIG_PATH = path.join(ROOT, 'docs', 'config', 'usr-guardrails', 'item-40-pipeline-incremental-transforms.json');

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

  const languageProfiles = await readJson(config.inputs.languageProfiles);
  const parserRuntimeLock = await readJson(config.inputs.parserRuntimeLock);
  const generatedProvenance = await readJson(config.inputs.generatedProvenance);
  const failureInjection = await readJson(config.inputs.failureInjection);

  const languageRows = ensureArray(languageProfiles.json.rows);
  const parserRows = ensureArray(parserRuntimeLock.json.rows);
  const provenanceRows = ensureArray(generatedProvenance.json.rows);
  const failureRows = ensureArray(failureInjection.json.rows);

  const parserSources = new Set(parserRows.map((row) => row.parserSource));
  const languageParserPreferences = new Set(
    languageRows
      .map((row) => row.parserPreference)
      .filter((value) => typeof value === 'string' && value.length > 0)
  );
  const failureLayers = new Set(failureRows.map((row) => row.injectionLayer));

  const report = {
    section: config.section,
    item: config.item,
    generatedAt: new Date().toISOString(),
    metrics: {
      languageProfiles: languageRows.length,
      parserRuntimeLocks: parserRows.length,
      uniqueParserSources: parserSources.size,
      languageParserPreferences: languageParserPreferences.size,
      requiredParserSources: ensureArray(config.requiredParserSources).length,
      generatedProvenanceRows: provenanceRows.length,
      approximateProvenanceRows: provenanceRows.filter((row) => row.mappingExpectation === 'approximate').length,
      failureInjectionRows: failureRows.length,
      blockingFailureRows: failureRows.filter((row) => row.blocking === true).length,
      uniqueFailureLayers: failureLayers.size,
      requiredFailureLayers: ensureArray(config.requiredFailureLayers).length
    },
    sourceDigest: hashInputs([
      configRaw,
      languageProfiles.raw,
      parserRuntimeLock.raw,
      generatedProvenance.raw,
      failureInjection.raw
    ])
  };

  if (!argv.quiet) {
    console.log(
      `[bench] usr-item40 langs=${report.metrics.languageProfiles} `
      + `parserLocks=${report.metrics.parserRuntimeLocks} provenance=${report.metrics.generatedProvenanceRows} `
      + `failures=${report.metrics.failureInjectionRows}`
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
