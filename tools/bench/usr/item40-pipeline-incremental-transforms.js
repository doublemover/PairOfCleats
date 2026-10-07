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

const CONFIG_PATH = repoPath('docs', 'config', 'usr-guardrails', 'item-40-pipeline-incremental-transforms.json');

const main = async () => {
  const argv = parseBenchArgs();
  const { json: config, raw: configRaw } = await readJsonFileWithRaw(CONFIG_PATH);

  const languageProfiles = await readJsonFromRoot(config.inputs.languageProfiles);
  const parserRuntimeLock = await readJsonFromRoot(config.inputs.parserRuntimeLock);
  const generatedProvenance = await readJsonFromRoot(config.inputs.generatedProvenance);
  const failureInjection = await readJsonFromRoot(config.inputs.failureInjection);

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

  await writeBenchJson(argv.json, report);
};

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
