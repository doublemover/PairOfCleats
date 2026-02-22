import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const resolveGateScript = (relativePath) => path.join(ROOT, relativePath);

/**
 * Canonical USR guardrail registry used by CI orchestration and coverage tests.
 * Every gate must declare scope + remediation command so operators have a deterministic
 * path from failure output to the exact fix command.
 */
export const USR_GUARDRAIL_GATES = Object.freeze([
  {
    item: 35,
    label: 'USR guardrail (item 35: framework canonicalization)',
    scope: 'framework canonicalization',
    script: 'tools/ci/usr/item35-framework-canonicalization-gate.js',
    report: 'usr-section-35-framework-canonicalization-report.json',
    remediationCommand: 'node tools/ci/usr/item35-framework-canonicalization-gate.js --out <diagnostics>/usr/usr-section-35-framework-canonicalization-report.json'
  },
  {
    item: 36,
    label: 'USR guardrail (item 36: backward-compatibility matrix)',
    scope: 'backward-compatibility matrix',
    script: 'tools/ci/usr/item36-backcompat-matrix-gate.js',
    report: 'usr-section-36-backcompat-matrix-report.json',
    remediationCommand: 'node tools/ci/usr/item36-backcompat-matrix-gate.js --out <diagnostics>/usr/usr-section-36-backcompat-matrix-report.json'
  },
  {
    item: 37,
    label: 'USR guardrail (item 37: governance drift)',
    scope: 'governance drift',
    script: 'tools/ci/usr/item37-governance-drift-gate.js',
    report: 'usr-section-37-governance-drift-report.json',
    remediationCommand: 'node tools/ci/usr/item37-governance-drift-gate.js --out <diagnostics>/usr/usr-section-37-governance-drift-report.json'
  },
  {
    item: 38,
    label: 'USR guardrail (item 38: catalog contract)',
    scope: 'catalog contract',
    script: 'tools/ci/usr/item38-catalog-contract-gate.js',
    report: 'usr-section-38-catalog-contract-report.json',
    remediationCommand: 'node tools/ci/usr/item38-catalog-contract-gate.js --out <diagnostics>/usr/usr-section-38-catalog-contract-report.json'
  },
  {
    item: 39,
    label: 'USR guardrail (item 39: normalization linking identity)',
    scope: 'normalization linking identity',
    script: 'tools/ci/usr/item39-normalization-linking-identity-gate.js',
    report: 'usr-section-39-normalization-linking-report.json',
    remediationCommand: 'node tools/ci/usr/item39-normalization-linking-identity-gate.js --out <diagnostics>/usr/usr-section-39-normalization-linking-report.json'
  },
  {
    item: 40,
    label: 'USR guardrail (item 40: pipeline incremental transforms)',
    scope: 'pipeline incremental transforms',
    script: 'tools/ci/usr/item40-pipeline-incremental-transforms-gate.js',
    report: 'usr-section-40-pipeline-incremental-report.json',
    remediationCommand: 'node tools/ci/usr/item40-pipeline-incremental-transforms-gate.js --out <diagnostics>/usr/usr-section-40-pipeline-incremental-report.json'
  }
]);

/**
 * Validate guardrail registry shape at startup so CI fails early with actionable
 * configuration errors instead of silently skipping required metadata.
 *
 * @param {Array<object>} [gates]
 * @returns {void}
 */
export const validateUsrGuardrailGates = (gates = USR_GUARDRAIL_GATES) => {
  const seenItems = new Set();
  for (const gate of gates) {
    if (!Number.isInteger(gate?.item)) {
      throw new Error(`Invalid USR guardrail item: ${gate?.item}`);
    }
    if (seenItems.has(gate.item)) {
      throw new Error(`Duplicate USR guardrail item: ${gate.item}`);
    }
    seenItems.add(gate.item);
    if (!gate?.label || !String(gate.label).trim()) {
      throw new Error(`Missing label for USR guardrail item ${gate.item}`);
    }
    if (!gate?.scope || !String(gate.scope).trim()) {
      throw new Error(`Missing scope for USR guardrail item ${gate.item}`);
    }
    if (!gate?.script || !String(gate.script).trim()) {
      throw new Error(`Missing script for USR guardrail item ${gate.item}`);
    }
    if (!gate?.report || !String(gate.report).trim()) {
      throw new Error(`Missing report for USR guardrail item ${gate.item}`);
    }
    if (!gate?.remediationCommand || !String(gate.remediationCommand).trim()) {
      throw new Error(`Missing remediation command for USR guardrail item ${gate.item}`);
    }
    const scriptPath = resolveGateScript(gate.script);
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Missing script for USR guardrail item ${gate.item}: ${gate.script}`);
    }
  }
};
