#!/usr/bin/env node
import {
  ensureArray,
  finishGate,
  parseGateArgs,
  readConfig,
  readJsonFromRoot,
  readTextFromRoot,
  repoPath,
  writeGateReport
} from './shared.js';

const CONFIG_PATH = repoPath('docs', 'config', 'usr-guardrails', 'item-37-governance-drift.json');

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

const escapeRegex = (value) => value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
const hasGlobTokens = (value) => /[*?]/.test(value);

/**
 * Convert a simple glob pattern (`*`, `?`) into an anchored regular expression.
 *
 * @param {string} pattern
 * @returns {RegExp}
 */
const globToRegex = (pattern) => (
  new RegExp(`^${escapeRegex(pattern).replace(/\\\*/g, '.*').replace(/\\\?/g, '.')}$`)
);

/**
 * Extract unique inline-code references from markdown-like text.
 *
 * @param {string} text
 * @returns {string[]}
 */
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
  const argv = parseGateArgs();
  const config = await readConfig(CONFIG_PATH);

  const ownershipMatrix = await readJsonFromRoot(config.inputs.ownershipMatrix);
  const governanceSpec = await readTextFromRoot(config.inputs.governanceSpec);
  const coverageMatrix = await readTextFromRoot(config.inputs.coverageMatrix);

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

  await writeGateReport({ argv, config, report });
  finishGate({
    report,
    passedMessage: 'item 37 gate passed',
    failedMessage: 'item 37 gate failed',
    strict: argv.strict
  });
};

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
