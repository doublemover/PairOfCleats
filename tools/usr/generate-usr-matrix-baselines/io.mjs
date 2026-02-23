import fs from 'node:fs';
import path from 'node:path';
import { equalsIgnoringEol } from '../../../src/shared/eol.js';

/**
 * Parse CLI flags for baseline generation/check workflows.
 *
 * @param {string[]} [argv=process.argv.slice(2)]
 * @param {string} defaultMatrixDir
 * @returns {{matrixDir:string,checkMode:boolean}}
 */
function parseGeneratorOptions(argv = process.argv.slice(2), defaultMatrixDir) {
  if (!defaultMatrixDir) {
    throw new Error('defaultMatrixDir is required');
  }
  let matrixDir = defaultMatrixDir;
  let checkMode = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || '');
    if (arg === '--check') {
      checkMode = true;
      continue;
    }
    if (arg === '--out-dir') {
      const value = String(argv[i + 1] || '');
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --out-dir');
      }
      matrixDir = path.resolve(value);
      i += 1;
      continue;
    }
    if (arg.startsWith('--out-dir=')) {
      const value = arg.slice('--out-dir='.length);
      if (!value) throw new Error('Missing value for --out-dir');
      matrixDir = path.resolve(value);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return { matrixDir, checkMode };
}

/**
 * Read UTF-8 file content and treat ENOENT as null.
 *
 * This keeps existence checks and reads in one syscall path instead of a
 * separate stat+read sequence.
 *
 * @param {string} filePath
 * @returns {string | null}
 */
function readUtf8IfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Ensure output directory exists.
 *
 * @param {string} matrixDir
 * @returns {void}
 */
function ensureDir(matrixDir) {
  fs.mkdirSync(matrixDir, { recursive: true });
}

/**
 * Assert one record file matches serialized content (EOL-insensitive).
 *
 * @param {{registryId:string,filePath:string,serialized:string}} record
 * @returns {string | null}
 */
function assertRegistryMatches(record) {
  const current = readUtf8IfExists(record.filePath);
  if (current === null) return `missing file: ${record.filePath}`;
  return equalsIgnoringEol(current, record.serialized) ? null : `drift: ${record.registryId}`;
}

/**
 * Collect all drift issues for precomputed registry records.
 *
 * @param {{registryId:string,filePath:string,serialized:string}[]} records
 * @returns {string[]}
 */
function collectRegistryDrift(records) {
  const drift = [];
  for (const record of records) {
    const issue = assertRegistryMatches(record);
    if (issue) drift.push(issue);
  }
  return drift;
}

/**
 * Persist one record and skip writes when file bytes are already identical.
 *
 * Invariant: byte-identical content is skipped, while EOL-only differences are
 * still rewritten so canonical generator output remains stable.
 *
 * @param {{registryId:string,filePath:string,serialized:string}} record
 * @returns {'created'|'updated'|'unchanged'}
 */
function writeRegistryRecord(record) {
  const current = readUtf8IfExists(record.filePath);
  if (current === record.serialized) {
    return 'unchanged';
  }
  fs.writeFileSync(record.filePath, record.serialized, 'utf8');
  return current === null ? 'created' : 'updated';
}

/**
 * Write all records and return a compact write report.
 *
 * @param {{registryId:string,filePath:string,serialized:string}[]} records
 * @returns {{created:number,updated:number,unchanged:number}}
 */
function writeRegistryRecords(records) {
  const report = { created: 0, updated: 0, unchanged: 0 };
  for (const record of records) {
    const outcome = writeRegistryRecord(record);
    report[outcome] += 1;
  }
  return report;
}

export {
  parseGeneratorOptions,
  ensureDir,
  assertRegistryMatches,
  collectRegistryDrift,
  writeRegistryRecord,
  writeRegistryRecords
};
