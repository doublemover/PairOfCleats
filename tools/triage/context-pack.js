#!/usr/bin/env node
import { getRecordPackages } from '../../src/integrations/triage/record-utils.js';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { search } from '../../src/integrations/core/search.js';
import { getRepoCacheRoot, getRuntimeConfig, getTriageConfig, resolveRepoConfig, resolveRuntimeEnv } from '../shared/dict-utils.js';
import { setEmbeddingsEnv } from '../../src/shared/env/runtime.js';
import { writeJsonFileResolved } from '../../src/shared/json-file.js';
import { resolveRecordPathSafe } from './context-pack-paths.js';
import { buildTriageHistorySelection } from './history-selection.js';
import { loadTriageRecordSnapshot } from './record-snapshot.js';
import { describeStorageFailure } from '../../src/shared/storage/failure-observation.js';
import { projectTriageEvidence } from './evidence.js';
import { TRIAGE_EVIDENCE_VERSION } from '../../src/contracts/triage-evidence.js';
import { parseTriageHistoryCursor } from '../../src/contracts/validators/triage-history.js';

const argv = createCli({
  scriptName: 'triage-context-pack',
  options: {
    'stub-embeddings': { type: 'boolean', default: false },
    ann: { type: 'boolean' },
    repo: { type: 'string' },
    record: { type: 'string' },
    out: { type: 'string' },
    'history-after': { type: 'string', description: 'JSON exact-history continuation from the preceding context pack.' }
  }
}).parse();
const rawArgs = process.argv.slice(2);
const annFlagPresent = rawArgs.includes('--ann') || rawArgs.includes('--no-ann');

const { repoRoot, userConfig } = resolveRepoConfig(argv.repo);
const recordId = String(argv.record || '').trim();
if (!recordId) {
  console.error('usage: node tools/triage/context-pack.js --record <recordId> [--repo <path>] [--out <file>] [--history-after <json>] [--no-ann] [--stub-embeddings]');
  process.exit(1);
}

const runtimeConfig = getRuntimeConfig(repoRoot, userConfig);
const baseEnv = resolveRuntimeEnv(runtimeConfig, process.env);
const triageConfig = getTriageConfig(repoRoot, userConfig);
const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const recordsDir = triageConfig.recordsDir;
const findingSnapshot = await loadRecord(recordsDir, recordId);
const finding = findingSnapshot?.record;

if (!finding) {
  console.error(`Finding record not found: ${recordId}`);
  process.exit(1);
}

const outPath = argv.out
  ? path.resolve(argv.out)
  : path.join(repoCacheRoot, 'triage', 'context-packs', `${recordId}.json`);

const contextPackConfig = triageConfig.contextPack || {};
const maxHistory = Number.isFinite(Number(contextPackConfig.maxHistory)) ? Number(contextPackConfig.maxHistory) : 5;
const maxEvidencePerQuery = Number.isFinite(Number(contextPackConfig.maxEvidencePerQuery))
  ? Number(contextPackConfig.maxEvidencePerQuery)
  : 5;

const warnings = [];
const indexCache = new Map();
const sqliteCache = new Map();
let historyCursor = null;
if (argv['history-after'] !== undefined) {
  historyCursor = parseTriageHistoryCursor(argv['history-after']);
}
const { history, historySelection } = await buildTriageHistorySelection({
  recordsDir,
  repoRoot,
  recordId,
  finding,
  findingObservation: findingSnapshot.observation,
  maxHistory,
  warnings,
  cursor: historyCursor
});

const repoEvidence = await buildRepoEvidence({
  repoRoot,
  finding,
  maxEvidencePerQuery,
  warnings
});

const pack = {
  evidenceVersion: TRIAGE_EVIDENCE_VERSION,
  recordId,
  generatedAt: new Date().toISOString(),
  finding,
  history,
  historySelection,
  repoEvidence,
  warnings: warnings.length ? warnings : undefined
};

await writeJsonFileResolved(outPath, pack);

console.log(JSON.stringify({
  outPath,
  evidenceVersion: TRIAGE_EVIDENCE_VERSION,
  searchedRepository: repoEvidence.repository,
  historyCount: history.length,
  historyState: historySelection.coverage.state,
  exactHistoryContinuation: historySelection.continuationState,
  evidenceQueries: repoEvidence.queries.length,
  warnings: warnings.length ? warnings : undefined
}, null, 2));

/**
 * Build per-query repository evidence hits across supported retrieval modes.
 *
 * @param {object} input
 * @returns {Promise<{queries:Array<object>}>}
 */
async function buildRepoEvidence({ repoRoot, finding, maxEvidencePerQuery, warnings }) {
  const queries = buildEvidenceQueries(finding);
  const results = [];
  for (const query of queries) {
    for (const mode of ['code', 'prose', 'extracted-prose']) {
      const result = await runSearchJson({
        repoRoot,
        query,
        mode,
        metaFilters: [],
        top: maxEvidencePerQuery
      });
      const evidence = projectTriageEvidence({ repoRoot, query, mode, result, limit: maxEvidencePerQuery });
      if (evidence.status === 'unavailable') warnings.push({
        step: 'evidence-search', mode, query, repository: evidence.repository,
        code: evidence.diagnostic.code, error: evidence.diagnostic.message
      });
      results.push(evidence);
    }
  }
  return { schemaVersion: TRIAGE_EVIDENCE_VERSION,
    repository: { root: path.resolve(repoRoot), identityKind: 'search-root-path' }, queries: results };
}

function buildEvidenceQueries(finding) {
  const queries = new Set();
  const vulnId = finding?.vuln?.cve || finding?.vuln?.vulnId;
  if (vulnId) queries.add(vulnId);
  for (const pkg of getRecordPackages(finding)) {
    if (pkg.name) queries.add(pkg.name);
    for (const alias of [pkg.importName, pkg.module, pkg.moduleName]) {
      if (typeof alias === 'string' && alias.trim()) queries.add(alias);
    }
    if (pkg.name?.includes('/')) queries.add(pkg.name.split('/').pop());
    if (pkg.manifestPath) queries.add(path.basename(pkg.manifestPath));
  }
  const importName = pickImportName(finding);
  if (importName) queries.add(importName);
  const exposureEndpoint = finding?.exposure?.publicEndpoint;
  if (exposureEndpoint) queries.add(exposureEndpoint);
  return Array.from(queries).filter(Boolean);
}

function pickImportName(finding) {
  const legacyPackage = Array.isArray(finding?.packages) ? null : finding?.package;
  const candidates = [
    legacyPackage?.importName,
    legacyPackage?.module,
    legacyPackage?.moduleName,
    finding?.importName,
    finding?.import,
    finding?.module
  ];
  return candidates.find((value) => typeof value === 'string' && value.trim());
}

async function loadRecord(recordsDir, recordId) {
  const filePath = resolveRecordPathSafe(recordsDir, recordId);
  if (!filePath) return null;
  try {
    return await loadTriageRecordSnapshot(recordsDir, recordId, { recordType: 'finding' });
  } catch (error) {
    const diagnostic = describeStorageFailure(error, { phase: 'triage-finding-read', defaultCode: 'ERR_TRIAGE_FINDING_READ' });
    if (diagnostic.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Run search in-process and return JSON payload/error as a tagged result.
 *
 * @param {{repoRoot:string,query:string,mode:string,metaFilters:string[],top:number}} input
 * @returns {Promise<{ok:boolean,payload?:object|null,error?:string}>}
 */
async function runSearchJson({ repoRoot, query, mode, metaFilters, top }) {
  const args = ['--mode', mode, '--json', '-n', String(top)];
  if (Array.isArray(metaFilters)) {
    metaFilters.forEach((filter) => {
      args.push('--meta', filter);
    });
  }
  if (annFlagPresent && argv.ann === true) args.push('--ann');
  if (annFlagPresent && argv.ann === false) args.push('--no-ann');
  try {
    const payload = await withSearchEnv(async () => await search(repoRoot, {
      query,
      args,
      argsMode: 'complete',
      emitOutput: false,
      exitOnError: false,
      indexCache,
      sqliteCache
    }));
    return { ok: true, payload };
  } catch (err) {
    const diagnostic = describeStorageFailure(err, { phase: 'triage-evidence-search',
      defaultCode: 'ERR_TRIAGE_EVIDENCE_SEARCH', defaultMessage: 'Search unavailable.' });
    return { ok: false, code: diagnostic.code, error: diagnostic.message, payload: null };
  }
}

async function withSearchEnv(callback) {
  const originalEnv = new Map();
  for (const [key, value] of Object.entries(baseEnv)) {
    originalEnv.set(key, process.env[key]);
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }
  if (argv['stub-embeddings']) {
    originalEnv.set('PAIROFCLEATS_EMBEDDINGS', setEmbeddingsEnv('stub'));
  }
  try {
    return await callback();
  } finally {
    for (const [key, value] of originalEnv.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
