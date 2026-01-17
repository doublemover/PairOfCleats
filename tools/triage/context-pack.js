#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { execaSync } from 'execa';
import { createCli } from '../../src/shared/cli.js';
import { getRepoCacheRoot, getRuntimeConfig, getTriageConfig, loadUserConfig, resolveRepoRoot, resolveRuntimeEnv, resolveToolRoot } from '../dict-utils.js';

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

const repoRoot = argv.repo ? path.resolve(argv.repo) : resolveRepoRoot(process.cwd());
const recordId = String(argv.record || '').trim();
if (!recordId) {
  console.error('usage: node tools/triage/context-pack.js --record <recordId> [--repo <path>] [--out <file>] [--no-ann] [--stub-embeddings]');
  process.exit(1);
}

const userConfig = loadUserConfig(repoRoot);
const runtimeConfig = getRuntimeConfig(repoRoot, userConfig);
const baseEnv = resolveRuntimeEnv(runtimeConfig, process.env);
const triageConfig = getTriageConfig(repoRoot, userConfig);
const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const recordsDir = triageConfig.recordsDir;
const finding = await loadRecord(recordsDir, recordId);

if (!finding) {
  console.error(`Finding record not found: ${path.join(recordsDir, `${recordId}.json`)}`);
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
const history = await buildHistory({
  repoRoot,
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

await fsPromises.mkdir(path.dirname(outPath), { recursive: true });
await fsPromises.writeFile(outPath, JSON.stringify(pack, null, 2));

console.log(JSON.stringify({
  outPath,
  historyCount: history.length,
  evidenceQueries: repoEvidence.queries.length,
  warnings: warnings.length ? warnings : undefined
}, null, 2));

async function buildHistory({ repoRoot, recordsDir, recordId, finding, maxHistory, warnings }) {
  const historyMap = new Map();
  const vulnId = finding?.vuln?.cve || finding?.vuln?.vulnId || null;
  const packageName = finding?.package?.name || null;
  const manifestName = finding?.package?.manifestPath
    ? path.basename(finding.package.manifestPath)
    : null;
  const routeQuery = [finding?.service, finding?.env].filter(Boolean).join(' ').trim();

  const baseMeta = ['recordType=decision'];
  const routeMeta = [...baseMeta];
  if (finding?.service) routeMeta.push(`service=${finding.service}`);
  if (finding?.env) routeMeta.push(`env=${finding.env}`);

  const queryList = Array.from(new Set([vulnId, packageName, manifestName, routeQuery].filter(Boolean)));
  if (!queryList.length) return [];

  const runQueries = async (metaFilters) => {
    for (const query of queryList) {
      const result = runSearchJson({
        repoRoot,
        query,
        mode: 'records',
        metaFilters,
        top: maxHistory
      });
      if (!result.ok) {
        warnings.push({ step: 'history-search', query, error: result.error });
        continue;
      }
      const hits = Array.isArray(result.payload?.records) ? result.payload.records : [];
      for (const hit of hits) {
        const hitId = extractRecordId(hit);
        if (!hitId || hitId === recordId || historyMap.has(hitId)) continue;
        const record = await loadRecord(recordsDir, hitId);
        if (!record) continue;
        historyMap.set(hitId, record);
        if (historyMap.size >= maxHistory) break;
      }
      if (historyMap.size >= maxHistory) break;
    }
  };

  await runQueries(routeMeta);
  if (historyMap.size < maxHistory && routeMeta.length > baseMeta.length) {
    await runQueries(baseMeta);
  }

  return Array.from(historyMap.values()).slice(0, maxHistory);
}

async function buildRepoEvidence({ repoRoot, finding, maxEvidencePerQuery, warnings }) {
  const queries = buildEvidenceQueries(finding);
  const results = [];
  for (const query of queries) {
    for (const mode of ['code', 'prose', 'extracted-prose']) {
      const result = runSearchJson({
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
  const packageName = finding?.package?.name;
  if (packageName) queries.add(packageName);
  const importName = pickImportName(finding);
  if (importName) queries.add(importName);
  if (!importName && packageName && packageName.includes('/')) {
    const unscoped = packageName.split('/').pop();
    if (unscoped && unscoped !== packageName) queries.add(unscoped);
  }
  const manifestPath = finding?.package?.manifestPath;
  if (manifestPath) queries.add(path.basename(manifestPath));
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
  const filePath = path.join(recordsDir, `${recordId}.json`);
  try {
    const raw = await fsPromises.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function runSearchJson({ repoRoot, query, mode, metaFilters, top }) {
  const scriptRoot = resolveToolRoot();
  const searchPath = path.join(scriptRoot, 'search.js');
  const args = [searchPath, query, '--mode', mode, '--json', '--top', String(top), '--repo', repoRoot];
  if (Array.isArray(metaFilters)) {
    metaFilters.forEach((filter) => {
      args.push('--meta', filter);
    });
  }
  if (annFlagPresent && argv.ann === true) args.push('--ann');
  if (annFlagPresent && argv.ann === false) args.push('--no-ann');
  const env = { ...baseEnv };
  if (argv['stub-embeddings']) env.PAIROFCLEATS_EMBEDDINGS = 'stub';
  const result = execaSync(process.execPath, args, { cwd: repoRoot, env, encoding: 'utf8', reject: false });
  if (result.exitCode !== 0) {
    return { ok: false, error: result.stderr || result.stdout || 'search failed', payload: null };
  }
  try {
    const payload = JSON.parse(result.stdout || '{}');
    return { ok: true, payload };
  } catch (err) {
    return { ok: false, error: err?.message || 'failed to parse search output', payload: null };
  }
}
