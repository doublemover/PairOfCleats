#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CONFIG_PATH = path.join(ROOT, 'docs', 'config', 'usr-guardrails', 'item-40-pipeline-incremental-transforms.json');

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = { out: '', strict: true };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--out') {
      out.out = args[i + 1] || '';
      i += 1;
      continue;
    }
    if (arg === '--no-strict') {
      out.strict = false;
    }
  }
  return out;
};

const readJson = async (relativePath) => {
  const absolutePath = path.join(ROOT, relativePath);
  const raw = await fs.readFile(absolutePath, 'utf8');
  return JSON.parse(raw);
};

const ensureArray = (value) => (Array.isArray(value) ? value : []);

const main = async () => {
  const argv = parseArgs();
  const config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'));

  const languageProfilesJson = await readJson(config.inputs.languageProfiles);
  const parserRuntimeLockJson = await readJson(config.inputs.parserRuntimeLock);
  const generatedProvenanceJson = await readJson(config.inputs.generatedProvenance);
  const failureInjectionJson = await readJson(config.inputs.failureInjection);

  const languageRows = ensureArray(languageProfilesJson.rows);
  const parserRows = ensureArray(parserRuntimeLockJson.rows);
  const provenanceRows = ensureArray(generatedProvenanceJson.rows);
  const failureRows = ensureArray(failureInjectionJson.rows);

  const errors = [];
  const warnings = [];

  const parserSourcesFromLanguages = new Set();
  for (const row of languageRows) {
    if (typeof row.parserPreference === 'string' && row.parserPreference) {
      parserSourcesFromLanguages.add(row.parserPreference);
    }
  }

  const parserSourcesFromLocks = new Set();
  for (const row of parserRows) {
    parserSourcesFromLocks.add(row.parserSource);

    const requiredFields = [
      'parserSource',
      'languageId',
      'parserName',
      'parserVersion',
      'runtimeName',
      'runtimeVersion',
      'lockReason',
      'maxUpgradeBudgetDays'
    ];

    for (const field of requiredFields) {
      if (!(field in row)) {
        errors.push(`parser runtime lock row missing ${field}`);
      }
    }

    const budgetDays = Number(row.maxUpgradeBudgetDays);
    if (!Number.isInteger(budgetDays) || budgetDays <= 0) {
      errors.push(`invalid maxUpgradeBudgetDays for parser source ${row.parserSource}`);
    }
  }

  for (const requiredParserSource of ensureArray(config.requiredParserSources)) {
    if (!parserSourcesFromLocks.has(requiredParserSource)) {
      errors.push(`parser runtime lock missing parser source ${requiredParserSource}`);
    }
  }

  for (const parserSource of parserSourcesFromLanguages) {
    if (!parserSourcesFromLocks.has(parserSource)) {
      errors.push(`language parserPreference ${parserSource} missing parser runtime lock row`);
    }
  }

  const allowedMappingExpectations = new Set(['exact', 'approximate']);
  const provenanceIds = new Set();
  for (const row of provenanceRows) {
    const requiredFields = [
      'id',
      'languageId',
      'generationKind',
      'mappingExpectation',
      'requiredDiagnostics',
      'blocking'
    ];

    for (const field of requiredFields) {
      if (!(field in row)) {
        errors.push(`generated provenance row ${row.id || '<unknown>'} missing ${field}`);
      }
    }

    if (provenanceIds.has(row.id)) {
      errors.push(`duplicate generated provenance row id ${row.id}`);
    }
    provenanceIds.add(row.id);

    if (!allowedMappingExpectations.has(row.mappingExpectation)) {
      errors.push(`invalid mappingExpectation ${row.mappingExpectation} in ${row.id}`);
    }

    if (!Array.isArray(row.requiredDiagnostics)) {
      errors.push(`generated provenance row ${row.id} missing requiredDiagnostics array`);
    }
  }

  const failureLayers = new Set();
  const allowedOutcomes = new Set(['fail-closed', 'degrade-with-diagnostics', 'warn-only']);
  const failureIds = new Set();

  for (const row of failureRows) {
    const requiredFields = [
      'id',
      'faultClass',
      'injectionLayer',
      'strictExpectedOutcome',
      'nonStrictExpectedOutcome',
      'requiredDiagnostics',
      'requiredReasonCodes',
      'rollbackTriggerConsecutiveFailures',
      'requiredRecoveryArtifacts',
      'blocking'
    ];

    for (const field of requiredFields) {
      if (!(field in row)) {
        errors.push(`failure injection row ${row.id || '<unknown>'} missing ${field}`);
      }
    }

    if (failureIds.has(row.id)) {
      errors.push(`duplicate failure injection row id ${row.id}`);
    }
    failureIds.add(row.id);

    failureLayers.add(row.injectionLayer);

    if (!allowedOutcomes.has(row.strictExpectedOutcome)) {
      errors.push(`invalid strictExpectedOutcome ${row.strictExpectedOutcome} in ${row.id}`);
    }
    if (!allowedOutcomes.has(row.nonStrictExpectedOutcome)) {
      errors.push(`invalid nonStrictExpectedOutcome ${row.nonStrictExpectedOutcome} in ${row.id}`);
    }

    if (!Array.isArray(row.requiredRecoveryArtifacts) || row.requiredRecoveryArtifacts.length === 0) {
      errors.push(`failure injection row ${row.id} missing requiredRecoveryArtifacts`);
    }

    const rollbackFailures = Number(row.rollbackTriggerConsecutiveFailures);
    if (!Number.isInteger(rollbackFailures) || rollbackFailures <= 0) {
      errors.push(`failure injection row ${row.id} has invalid rollbackTriggerConsecutiveFailures`);
    }
  }

  for (const requiredLayer of ensureArray(config.requiredFailureLayers)) {
    if (!failureLayers.has(requiredLayer)) {
      errors.push(`failure injection matrix missing required layer ${requiredLayer}`);
    }
  }

  const report = {
    section: config.section,
    item: config.item,
    title: config.title,
    generatedAt: new Date().toISOString(),
    ok: errors.length === 0,
    sources: config.inputs,
    metrics: {
      languageProfiles: languageRows.length,
      parserRuntimeLocks: parserRows.length,
      generatedProvenanceRows: provenanceRows.length,
      failureInjectionRows: failureRows.length
    },
    errors,
    warnings
  };

  const defaultOut = path.join(ROOT, '.diagnostics', 'usr', config.report);
  const outPath = argv.out ? path.resolve(argv.out) : defaultOut;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (report.ok) {
    console.error('item 40 gate passed');
    return;
  }

  console.error('item 40 gate failed');
  for (const error of errors) {
    console.error(`- ${error}`);
  }

  if (argv.strict) {
    process.exit(1);
  }
};

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
