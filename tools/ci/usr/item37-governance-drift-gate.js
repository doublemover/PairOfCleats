#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CONFIG_PATH = path.join(ROOT, 'docs', 'config', 'usr-guardrails', 'item-37-governance-drift.json');

const REQUIRED_CORE_CONTRACTS = [
  'docs/specs/usr-core-governance-change.md',
  'docs/specs/usr-core-language-framework-catalog.md',
  'docs/specs/usr-core-normalization-linking-identity.md',
  'docs/specs/usr-core-pipeline-incremental-transforms.md'
];

const REQUIRED_APPROVAL_ROLES = [
  'usr-architecture',
  'usr-conformance',
  'usr-operations'
];

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

const readText = async (relativePath) => {
  const absolutePath = path.join(ROOT, relativePath);
  return fs.readFile(absolutePath, 'utf8');
};

const ensureArray = (value) => (Array.isArray(value) ? value : []);

const escapeRegex = (value) => value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
const hasGlobTokens = (value) => /[*?]/.test(value);
const globToRegex = (pattern) => (
  new RegExp(`^${escapeRegex(pattern).replace(/\\\*/g, '.*').replace(/\\\?/g, '.')}$`)
);

const extractInlineCodeReferences = (text) => {
  const refs = new Set();
  for (const match of text.matchAll(/`([^`\r\n]+)`/g)) {
    const value = match[1].trim();
    if (value) {
      refs.add(value);
    }
  }
  return [...refs];
};

const main = async () => {
  const argv = parseArgs();
  const config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'));

  const ownershipMatrix = await readJson(config.inputs.ownershipMatrix);
  const governanceSpec = await readText(config.inputs.governanceSpec);
  const coverageMatrix = await readText(config.inputs.coverageMatrix);

  const rows = ensureArray(ownershipMatrix.rows);
  const errors = [];
  const warnings = [];

  const requiredOwnershipFields = ensureArray(config.requiredOwnershipFields);
  for (const [index, row] of rows.entries()) {
    const fallbackRowId = `<row-${index}>`;
    const rowId = row?.id || fallbackRowId;

    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      errors.push(`ownership row ${fallbackRowId} is not an object`);
      continue;
    }

    for (const field of requiredOwnershipFields) {
      if (!(field in row)) {
        errors.push(`ownership row ${rowId} missing field ${field}`);
      }
    }

    const evidenceArtifacts = ensureArray(row.evidenceArtifacts);
    if (evidenceArtifacts.length === 0) {
      errors.push(`ownership row ${rowId} has empty evidenceArtifacts`);
    }

    if (row.ownerRole && row.ownerRole === row.backupOwnerRole) {
      warnings.push(`ownership row ${rowId} has identical owner and backup owner roles`);
    }
  }

  const governanceReferences = extractInlineCodeReferences(governanceSpec);
  const governanceReferenceSet = new Set(governanceReferences);
  const governanceGlobReferences = governanceReferences.filter(hasGlobTokens);

  for (const requiredRef of ensureArray(config.requiredGovernanceReferences)) {
    if (typeof requiredRef !== 'string' || requiredRef.trim() === '') {
      errors.push('required governance reference must be a non-empty string');
      continue;
    }

    const normalizedRef = requiredRef.trim();

    if (hasGlobTokens(normalizedRef)) {
      const globRegex = globToRegex(normalizedRef);
      const matchedByReference = governanceReferences.some((reference) => globRegex.test(reference));
      if (!matchedByReference && !governanceSpec.includes(normalizedRef)) {
        errors.push(`governance spec missing required reference: ${normalizedRef}`);
      }
      continue;
    }

    if (governanceReferenceSet.has(normalizedRef) || governanceSpec.includes(normalizedRef)) {
      continue;
    }

    const matchedByDeclaredGlob = governanceGlobReferences
      .some((reference) => globToRegex(reference).test(normalizedRef));
    if (!matchedByDeclaredGlob) {
      errors.push(`governance spec missing required reference: ${normalizedRef}`);
    }
  }

  for (const contractPath of REQUIRED_CORE_CONTRACTS) {
    if (!coverageMatrix.includes(contractPath)) {
      errors.push(`coverage matrix missing core contract reference: ${contractPath}`);
    }
  }

  for (const role of REQUIRED_APPROVAL_ROLES) {
    const hasBacktickedRole = coverageMatrix.includes(`\`${role}\``);
    const hasPlainRole = coverageMatrix.includes(role);
    if (!hasBacktickedRole && !hasPlainRole) {
      errors.push(`coverage matrix missing required approval role: ${role}`);
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
      ownershipRows: rows.length,
      requiredOwnershipFields: requiredOwnershipFields.length,
      requiredGovernanceReferences: ensureArray(config.requiredGovernanceReferences).length,
      requiredCoreContracts: REQUIRED_CORE_CONTRACTS.length
    },
    errors,
    warnings
  };

  const defaultOut = path.join(ROOT, '.diagnostics', 'usr', config.report);
  const outPath = argv.out ? path.resolve(argv.out) : defaultOut;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (report.ok) {
    console.error('item 37 gate passed');
    return;
  }

  console.error('item 37 gate failed');
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
