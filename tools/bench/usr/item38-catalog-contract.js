#!/usr/bin/env node
import crypto from 'node:crypto';
import {
  ensureArray,
  parseBenchArgs,
  readJsonFileWithRaw,
  readJsonFromRoot,
  repoPath,
  writeBenchJson
} from './shared.js';

const CONFIG_PATH = repoPath('docs', 'config', 'usr-guardrails', 'item-38-catalog-contract.json');
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
  const argv = parseBenchArgs();
  const { json: config, raw: configRaw } = await readJsonFileWithRaw(CONFIG_PATH);

  const languageProfiles = await readJsonFromRoot(config.inputs.languageProfiles);
  const frameworkProfiles = await readJsonFromRoot(config.inputs.frameworkProfiles);
  const edgeCases = await readJsonFromRoot(config.inputs.frameworkEdgeCases);
  const capabilityMatrix = await readJsonFromRoot(config.inputs.capabilityMatrix);
  const versionPolicy = await readJsonFromRoot(config.inputs.languageVersionPolicy);
  const embeddingPolicy = await readJsonFromRoot(config.inputs.languageEmbeddingPolicy);

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

  await writeBenchJson(argv.json, report);
};

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
