#!/usr/bin/env node
import { getRecordPackages } from '../../src/integrations/triage/record-utils.js';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { search } from '../../src/integrations/core/search.js';
import { getRepoCacheRoot, getRuntimeConfig, getTriageConfig, resolveRepoConfig, resolveRuntimeEnv } from '../shared/dict-utils.js';
import { setEmbeddingsEnv } from '../../src/shared/env/runtime.js';
import { writeJsonFileResolved } from '../../src/shared/json-file.js';
import { resolveRecordPathSafe } from './context-pack-paths.js';
import { buildTriageHistory } from './history.js';
import { loadTriageRecordSnapshot } from './record-snapshot.js';
import { describeStorageFailure } from '../../src/shared/storage/failure-observation.js';

const argv = createCli({
  scriptName: 'triage-context-pack',
  options: {
    'stub-embeddings': { type: 'boolean', default: false },
    ann: { type: 'boolean' },
    repo: { type: 'string' },
    record: { type: 'string' },
    out: { type: 'string' }
  }
}).parse();
const rawArgs = process.argv.slice(2);
const annFlagPresent = rawArgs.includes('--ann') || rawArgs.includes('--no-ann');

const { repoRoot, userConfig } = resolveRepoConfig(argv.repo);
const recordId = String(argv.record || '').trim();
if (!recordId) {
  console.error('usage: node tools/triage/context-pack.js --record <recordId> [--repo <path>] [--out <file>] [--no-ann] [--stub-embeddings]');
  process.exit(1);
}

const runtimeConfig = getRuntimeConfig(repoRoot, userConfig);
const baseEnv = resolveRuntimeEnv(runtimeConfig, process.env);
const triageConfig = getTriageConfig(repoRoot, userConfig);
const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const recordsDir = triageConfig.recordsDir;
const finding = await loadRecord(recordsDir, recordId);

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
const history = await buildTriageHistory({
  recordsDir,
  recordId,
  finding,
  maxHistory,
  warnings
});

const repoEvidence = await buildRepoEvidence({
  repoRoot,
  finding,
  maxEvidencePerQuery,
  warnings
});

const pack = {
  recordId,
  generatedAt: new Date().toISOString(),
  finding,
  history,
  repoEvidence,
  warnings: warnings.length ? warnings : undefined
};

await writeJsonFileResolved(outPath, pack);

console.log(JSON.stringify({
  outPath,
  historyCount: history.length,
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
      if (!result.ok) {
        warnings.push({ step: 'evidence-search', mode, query, error: result.error });
      }
      const hits = Array.isArray(result.payload?.[mode]) ? result.payload[mode] : [];
      results.push({
        query,
        mode,
        hits: hits.slice(0, maxEvidencePerQuery).map(pickEvidenceHit)
      });
    }
  }
  return { queries: results };
}

function buildEvidenceQueries(finding) {
  const queries = new Set();
  const vulnId = finding?.vuln?.cve || finding?.vuln?.vulnId;
  if (vulnId) queries.add(vulnId);
  for (const pkg of getRecordPackages(finding)) {
    if (pkg.name) queries.add(pkg.name);
    if (pkg.importName) queries.add(pkg.importName);
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
  const candidates = [
    finding?.package?.importName,
    finding?.package?.module,
    finding?.package?.moduleName,
    finding?.importName,
    finding?.import,
    finding?.module
  ];
  return candidates.find((value) => typeof value === 'string' && value.trim());
}

function pickEvidenceHit(hit) {
  return {
    file: hit.file,
    kind: hit.kind,
    name: hit.name,
    headline: hit.headline,
    score: hit.score,
    scoreType: hit.scoreType,
    scoreBreakdown: hit.scoreBreakdown || null,
    snippet: buildSnippet(hit)
  };
}

function buildSnippet(hit) {
  const parts = [];
  if (hit.headline) parts.push(hit.headline);
  if (Array.isArray(hit.preContext)) parts.push(...hit.preContext);
  if (Array.isArray(hit.postContext)) parts.push(...hit.postContext);
  const raw = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  return raw.length > 240 ? `${raw.slice(0, 237)}...` : raw;
}

function extractRecordId(hit) {
  if (hit?.docmeta?.record?.recordId) return hit.docmeta.record.recordId;
  if (hit?.file) return path.basename(hit.file, path.extname(hit.file));
  return null;
}

async function loadRecord(recordsDir, recordId) {
  const filePath = resolveRecordPathSafe(recordsDir, recordId);
  if (!filePath) return null;
  try {
    return (await loadTriageRecordSnapshot(recordsDir, recordId, { recordType: 'finding' })).record;
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
    return { ok: false, error: err?.message || 'search failed', payload: null };
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
