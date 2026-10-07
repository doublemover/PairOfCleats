#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseJsonc } from 'jsonc-parser';
import { buildUsrFullConformanceSurfaceReport } from '../../src/contracts/validators/usr-matrix.js';
import { validateUsrReport } from '../../src/contracts/validators/usr.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_MATRIX_DIR = path.join(DEFAULT_ROOT, 'tests', 'lang', 'matrix');

const MATRIX_FILES = Object.freeze({
  languageProfilesPayload: 'usr-language-profiles.json',
  frameworkProfilesPayload: 'usr-framework-profiles.json',
  capabilityMatrixPayload: 'usr-capability-matrix.json',
  conformanceLevelsPayload: 'usr-conformance-levels.json',
  fixtureGovernancePayload: 'usr-fixture-governance.json',
  batchShardsPayload: 'usr-language-batch-shards.json',
  artifactExpectationsPayload: 'usr-artifact-expectations.json'
});

const usage = () => [
  'usage: node tools/usr/conformance-surface.js [--check] [--json <path>] [--matrix-dir <path>] [--repo-root <path>]',
  '',
  'Build and validate the aggregate USR full-language conformance summary.'
].join('\n');

const parseArgs = (rawArgs) => {
  const options = {
    check: false,
    json: '',
    matrixDir: DEFAULT_MATRIX_DIR,
    repoRoot: DEFAULT_ROOT
  };
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = String(rawArgs[i] || '');
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--check') {
      options.check = true;
      continue;
    }
    const readValue = (flag) => {
      const next = rawArgs[i + 1];
      if (next == null || String(next).startsWith('-')) {
        throw new Error(`Missing value for ${flag}`);
      }
      i += 1;
      return String(next);
    };
    if (arg === '--json') {
      options.json = readValue(arg);
      continue;
    }
    if (arg === '--matrix-dir') {
      options.matrixDir = readValue(arg);
      continue;
    }
    if (arg === '--repo-root') {
      options.repoRoot = readValue(arg);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  options.repoRoot = path.resolve(options.repoRoot);
  options.matrixDir = path.resolve(options.matrixDir);
  options.json = options.json ? path.resolve(options.repoRoot, options.json) : '';
  return options;
};

const readJson = async (filePath) => JSON.parse(await fsPromises.readFile(filePath, 'utf8'));

const readRunRulesKnownLanes = async (repoRoot) => {
  const rulesPath = path.join(repoRoot, 'tests', 'run.rules.jsonc');
  try {
    const parsed = parseJsonc(await fsPromises.readFile(rulesPath, 'utf8'));
    return Array.isArray(parsed?.knownLanes)
      ? parsed.knownLanes.filter((lane) => typeof lane === 'string')
      : [];
  } catch {
    return [];
  }
};

const buildSelectorList = (batchShardsPayload) => {
  const rows = Array.isArray(batchShardsPayload?.rows) ? batchShardsPayload.rows : [];
  return rows
    .map((row) => {
      const orderManifest = typeof row?.orderManifest === 'string' ? row.orderManifest : '';
      if (!orderManifest) return '';
      return orderManifest
        .replace(/^tests\//u, '')
        .replace(/\/[^/]+\.order\.txt$/u, '/validation')
        .replace(/\\/g, '/');
    })
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
};

export async function buildUsrConformanceSurface({
  repoRoot = DEFAULT_ROOT,
  matrixDir = DEFAULT_MATRIX_DIR,
  now = () => new Date().toISOString()
} = {}) {
  const payloads = {};
  for (const [key, fileName] of Object.entries(MATRIX_FILES)) {
    payloads[key] = await readJson(path.join(matrixDir, fileName));
  }
  const knownLanes = await readRunRulesKnownLanes(repoRoot);
  const result = buildUsrFullConformanceSurfaceReport({
    ...payloads,
    knownLanes,
    generatedAt: now()
  });
  const selectors = buildSelectorList(payloads.batchShardsPayload);
  result.payload.summary = {
    ...result.payload.summary,
    selectors,
    selectorCount: selectors.length
  };
  const validation = validateUsrReport('usr-conformance-summary', result.payload);
  return {
    ...result,
    reportValidation: validation
  };
}

export async function runUsrConformanceSurface(rawArgs = process.argv.slice(2)) {
  const options = parseArgs(rawArgs);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return { ok: true, payload: null };
  }

  const result = await buildUsrConformanceSurface({
    repoRoot: options.repoRoot,
    matrixDir: options.matrixDir
  });

  if (!result.reportValidation.ok) {
    result.errors = Object.freeze([
      ...result.errors,
      ...result.reportValidation.errors.map((message) => `report ${message}`)
    ]);
  }

  if (options.json) {
    await fsPromises.mkdir(path.dirname(options.json), { recursive: true });
    await fsPromises.writeFile(options.json, `${JSON.stringify(result.payload, null, 2)}\n`, 'utf8');
  }

  const ok = result.ok && result.reportValidation.ok;
  if (!ok) {
    const messages = [...result.errors];
    if (messages.length === 0) messages.push('USR conformance surface failed.');
    if (options.check) {
      for (const message of messages) process.stderr.write(`${message}\n`);
      return { ok: false, payload: result.payload, errors: messages };
    }
  }

  if (!options.json) {
    process.stdout.write(`${JSON.stringify(result.payload, null, 2)}\n`);
  }
  return { ok, payload: result.payload, errors: result.errors };
}

if (isDirectExecution(import.meta.url)) {
  runUsrConformanceSurface()
    .then((result) => {
      if (result?.ok === false) process.exit(1);
    })
    .catch((error) => {
      process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
      process.exit(1);
    });
}
