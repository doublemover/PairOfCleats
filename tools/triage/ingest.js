#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import minimist from 'minimist';
import { getTriageConfig, loadUserConfig } from '../dict-utils.js';
import { normalizeDependabot } from '../../src/triage/normalize/dependabot.js';
import { normalizeAwsInspector } from '../../src/triage/normalize/aws-inspector.js';
import { normalizeGeneric } from '../../src/triage/normalize/generic.js';
import { renderRecordMarkdown } from '../../src/triage/render.js';

const argv = minimist(process.argv.slice(2), {
  boolean: ['build-index', 'incremental', 'stub-embeddings'],
  string: ['repo', 'source', 'in', 'meta'],
  alias: { i: 'in' }
});

const repoRoot = argv.repo ? path.resolve(argv.repo) : process.cwd();
const source = normalizeSource(argv.source);
const inputPath = argv.in ? path.resolve(argv.in) : null;

if (!source || !inputPath) {
  console.error('usage: node tools/triage/ingest.js --source dependabot|aws_inspector|generic --in <file> [--repo <path>] [--meta key=value] [--build-index]');
  process.exit(1);
}

const userConfig = loadUserConfig(repoRoot);
const triageConfig = getTriageConfig(repoRoot, userConfig);
const meta = parseMeta(argv.meta);

const normalizer = resolveNormalizer(source);
if (!normalizer) {
  console.error(`Unsupported source: ${source}`);
  process.exit(1);
}

const rawEntries = await loadInputEntries(inputPath);
await fsPromises.mkdir(triageConfig.recordsDir, { recursive: true });

const results = {
  source,
  repoRoot,
  recordsDir: triageConfig.recordsDir,
  total: rawEntries.length,
  written: 0,
  errors: 0,
  recordIds: [],
  records: [],
  errorDetails: []
};

for (let index = 0; index < rawEntries.length; index += 1) {
  const raw = rawEntries[index];
  try {
    const record = normalizer(raw, meta, {
      repoRoot,
      storeRawPayload: triageConfig.storeRawPayload
    });
    if (!record || !record.recordId) {
      throw new Error('Record normalization failed or missing recordId');
    }
    const jsonPath = path.join(triageConfig.recordsDir, `${record.recordId}.json`);
    const mdPath = path.join(triageConfig.recordsDir, `${record.recordId}.md`);
    await fsPromises.writeFile(jsonPath, JSON.stringify(record, null, 2));
    await fsPromises.writeFile(mdPath, renderRecordMarkdown(record));
    results.recordIds.push(record.recordId);
    results.records.push({ recordId: record.recordId, jsonPath, mdPath });
    results.written += 1;
  } catch (err) {
    results.errors += 1;
    results.errorDetails.push({
      index,
      message: err?.message || String(err)
    });
  }
}

if (argv['build-index']) {
  const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const args = [path.join(scriptRoot, 'build_index.js'), '--mode', 'records'];
  if (argv.incremental) args.push('--incremental');
  if (argv['stub-embeddings']) args.push('--stub-embeddings');
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(JSON.stringify(results, null, 2));

function normalizeSource(raw) {
  if (!raw) return '';
  const value = String(raw).trim().toLowerCase();
  if (value === 'dependabot') return 'dependabot';
  if (value === 'aws_inspector' || value === 'aws-inspector' || value === 'inspector' || value === 'aws') return 'aws_inspector';
  if (value === 'generic' || value === 'manual') return 'generic';
  return value;
}

function resolveNormalizer(sourceValue) {
  if (sourceValue === 'dependabot') return normalizeDependabot;
  if (sourceValue === 'aws_inspector') return normalizeAwsInspector;
  if (sourceValue === 'generic') return normalizeGeneric;
  return null;
}

function parseMeta(metaArg) {
  const entries = Array.isArray(metaArg) ? metaArg : (metaArg ? [metaArg] : []);
  const meta = {};
  for (const entry of entries) {
    const [rawKey, ...rest] = String(entry).split('=');
    const key = rawKey.trim();
    if (!key) continue;
    meta[key] = rest.join('=').trim();
  }
  return meta;
}

async function loadInputEntries(filePath) {
  const rawText = await fsPromises.readFile(filePath, 'utf8');
  const trimmed = rawText.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.alerts)) return parsed.alerts;
    if (Array.isArray(parsed.findings)) return parsed.findings;
    return [parsed];
  } catch {
    return parseJsonLines(trimmed);
  }
}

function parseJsonLines(rawText) {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const output = [];
  for (const line of lines) {
    try {
      output.push(JSON.parse(line));
    } catch {
      // skip invalid JSONL lines
    }
  }
  return output;
}
