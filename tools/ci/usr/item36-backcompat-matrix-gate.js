#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CONFIG_PATH = path.join(ROOT, 'docs', 'config', 'usr-guardrails', 'item-36-backcompat-matrix.json');
const USR_VERSION_PATTERN = /^usr-\d+\.\d+\.\d+$/;

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
const findDuplicates = (values) => {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value);
};

const main = async () => {
  const argv = parseArgs();
  const config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'));
  const matrix = await readJson(config.inputs.backcompatMatrix);
  const rows = ensureArray(matrix.rows);
  const requiredScenarioIds = ensureArray(config.requiredScenarioIds);
  const strictBlockingIds = ensureArray(config.strictBlockingIds);
  const nonStrictAdvisoryIds = ensureArray(config.nonStrictAdvisoryIds);

  const errors = [];
  const warnings = [];

  for (const duplicateId of findDuplicates(requiredScenarioIds)) {
    errors.push(`duplicate required scenario id in config: ${duplicateId}`);
  }
  for (const duplicateId of findDuplicates(strictBlockingIds)) {
    errors.push(`duplicate strict scenario id in config: ${duplicateId}`);
  }
  for (const duplicateId of findDuplicates(nonStrictAdvisoryIds)) {
    errors.push(`duplicate advisory scenario id in config: ${duplicateId}`);
  }

  const requiredIds = new Set(requiredScenarioIds);
  const strictIds = new Set(strictBlockingIds);
  const advisoryIds = new Set(nonStrictAdvisoryIds);

  for (const id of strictIds) {
    if (!requiredIds.has(id)) {
      errors.push(`strict scenario ${id} is not listed in requiredScenarioIds`);
    }
  }

  for (const id of advisoryIds) {
    if (!requiredIds.has(id)) {
      errors.push(`non-strict scenario ${id} is not listed in requiredScenarioIds`);
    }
  }

  for (const id of strictIds) {
    if (advisoryIds.has(id)) {
      errors.push(`scenario ${id} cannot be both strict and non-strict`);
    }
  }

  for (const id of requiredIds) {
    if (!strictIds.has(id) && !advisoryIds.has(id)) {
      errors.push(`required scenario ${id} is not classified as strict or non-strict`);
    }
  }

  const seenIds = new Set();
  const duplicateIds = new Set();
  const rowById = new Map();
  let pairwiseExpandedRows = 0;

  for (const row of rows) {
    const id = row.id;
    if (seenIds.has(id)) {
      duplicateIds.add(id);
    }
    seenIds.add(id);
    rowById.set(id, row);

    if (!/^BC-\d{3}$/.test(String(id || ''))) {
      warnings.push(`non-canonical scenario id format: ${id}`);
    }

    if (!USR_VERSION_PATTERN.test(String(row.producerVersion || ''))) {
      errors.push(`scenario ${id} has invalid producerVersion ${row.producerVersion}`);
    }

    if (!Array.isArray(row.readerVersions) || row.readerVersions.length === 0) {
      errors.push(`scenario ${id} is missing readerVersions`);
    } else {
      if (row.readerVersions.length > 1) {
        pairwiseExpandedRows += 1;
      }
      for (const version of row.readerVersions) {
        if (!USR_VERSION_PATTERN.test(String(version || ''))) {
          errors.push(`scenario ${id} has invalid readerVersion ${version}`);
        }
      }
    }

    if (!Array.isArray(row.requiredDiagnostics)) {
      errors.push(`scenario ${id} is missing requiredDiagnostics array`);
    } else if (row.expectedOutcome === 'reject' && row.requiredDiagnostics.length === 0) {
      errors.push(`scenario ${id} reject outcomes require at least one required diagnostic`);
    } else if (
      row.expectedOutcome === 'accept-with-adapter'
      && !row.requiredDiagnostics.includes('USR-W-BACKCOMPAT-ADAPTER')
    ) {
      warnings.push(`scenario ${id} accept-with-adapter should include USR-W-BACKCOMPAT-ADAPTER`);
    }
  }

  for (const duplicateId of duplicateIds) {
    errors.push(`duplicate scenario id: ${duplicateId}`);
  }

  for (const id of requiredScenarioIds) {
    if (!rowById.has(id)) {
      errors.push(`missing required scenario: ${id}`);
    }
  }

  for (const id of strictIds) {
    const row = rowById.get(id);
    if (!row) continue;
    if (row.readerMode !== 'strict') {
      errors.push(`strict scenario ${id} must use readerMode=strict`);
    }
    if (row.blocking !== true) {
      errors.push(`strict scenario ${id} must be blocking=true`);
    }
    if (!['accept', 'reject'].includes(row.expectedOutcome)) {
      errors.push(`strict scenario ${id} has invalid expectedOutcome ${row.expectedOutcome}`);
    }
  }

  for (const id of advisoryIds) {
    const row = rowById.get(id);
    if (!row) continue;
    if (row.readerMode !== 'non-strict') {
      errors.push(`non-strict scenario ${id} must use readerMode=non-strict`);
    }
    if (row.blocking !== false) {
      errors.push(`non-strict scenario ${id} must be blocking=false`);
    }
    if (row.expectedOutcome !== 'accept-with-adapter') {
      errors.push(`non-strict scenario ${id} must use expectedOutcome=accept-with-adapter`);
    }
  }

  if (pairwiseExpandedRows === 0) {
    errors.push('matrix must include at least one pairwise-expanded readerVersions row');
  }

  const report = {
    section: config.section,
    item: config.item,
    title: config.title,
    generatedAt: new Date().toISOString(),
    ok: errors.length === 0,
    sources: config.inputs,
    metrics: {
      totalRows: rows.length,
      requiredRows: requiredScenarioIds.length,
      strictRows: strictIds.size,
      advisoryRows: advisoryIds.size,
      pairwiseExpandedRows
    },
    errors,
    warnings
  };

  const defaultOut = path.join(ROOT, '.diagnostics', 'usr', config.report);
  const outPath = argv.out ? path.resolve(argv.out) : defaultOut;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (report.ok) {
    console.error('item 36 gate passed');
    return;
  }

  console.error('item 36 gate failed');
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
