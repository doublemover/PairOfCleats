#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { execaSync } from 'execa';
import { fileURLToPath } from 'node:url';
import { createCli } from '../../src/shared/cli.js';
import { getRuntimeConfig, getTriageConfig, loadUserConfig, resolveNodeOptions, resolveRepoRoot } from '../dict-utils.js';
import { normalizeDependabot } from '../../src/integrations/triage/normalize/dependabot.js';
import { normalizeAwsInspector } from '../../src/integrations/triage/normalize/aws-inspector.js';
import { normalizeGeneric } from '../../src/integrations/triage/normalize/generic.js';
import { renderRecordMarkdown } from '../../src/integrations/triage/render.js';

const argv = createCli({
  scriptName: 'triage-ingest',
  options: {
    'build-index': { type: 'boolean', default: false },
    incremental: { type: 'boolean', default: false },
    'stub-embeddings': { type: 'boolean', default: false },
    repo: { type: 'string' },
    source: { type: 'string' },
    in: { type: 'string' },
    meta: { type: 'string', array: true }
  },
  aliases: { i: 'in' }
}).parse();

const repoRoot = argv.repo ? path.resolve(argv.repo) : resolveRepoRoot(process.cwd());
const source = normalizeSource(argv.source);
const inputPath = argv.in ? path.resolve(repoRoot, argv.in) : null;

if (!source || !inputPath) {
  console.error('usage: node tools/triage/ingest.js --source dependabot|aws_inspector|generic --in <file> [--repo <path>] [--meta key=value] [--build-index]');
  process.exit(1);
}

const userConfig = loadUserConfig(repoRoot);
const runtimeConfig = getRuntimeConfig(repoRoot, userConfig);
const resolvedNodeOptions = resolveNodeOptions(runtimeConfig, process.env.NODE_OPTIONS || '');
const baseEnv = resolvedNodeOptions
  ? { ...process.env, NODE_OPTIONS: resolvedNodeOptions }
  : { ...process.env };
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
  const args = [path.join(scriptRoot, 'build_index.js'), '--mode', 'records', '--repo', repoRoot];
  if (argv.incremental) args.push('--incremental');
  if (argv['stub-embeddings']) args.push('--stub-embeddings');
  const env = { ...baseEnv };
  if (argv['stub-embeddings']) env.PAIROFCLEATS_EMBEDDINGS = 'stub';
  const result = execaSync(process.execPath, args, { cwd: repoRoot, stdio: 'inherit', env, reject: false });
  if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);
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
