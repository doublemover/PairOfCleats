import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertLanguageFrameworkApplicability,
  buildRegistryRecords,
  normalizeLanguageBaselines
} from './generate-usr-matrix-baselines/builders.mjs';
import {
  collectRegistryDrift,
  ensureDir,
  parseGeneratorOptions,
  writeRegistryRecords
} from './generate-usr-matrix-baselines/io.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const DEFAULT_MATRIX_DIR = path.join(repoRoot, 'tests', 'lang', 'matrix');

const { matrixDir, checkMode } = parseGeneratorOptions(process.argv.slice(2), DEFAULT_MATRIX_DIR);

/**
 * Run generator workflow in write or drift-check mode.
 *
 * @returns {void}
 */
function main() {
  assertLanguageFrameworkApplicability();
  ensureDir(matrixDir);
  const normalizedLanguages = normalizeLanguageBaselines();
  const registries = buildRegistryRecords(normalizedLanguages, matrixDir);
  if (checkMode) {
    const drift = collectRegistryDrift(registries);
    if (drift.length > 0) {
      throw new Error(`USR matrix baseline drift detected:\n${drift.join('\n')}`);
    }
    return;
  }
  writeRegistryRecords(registries);
}

main();
