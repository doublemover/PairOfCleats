#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSubprocessSync } from '../../src/shared/subprocess.js';
import { createCli } from '../../src/shared/cli.js';
import {
  getRuntimeConfig,
  getTriageConfig,
  resolveRepoConfig,
  resolveRuntimeEnv,
  resolveToolRoot
} from '../shared/dict-utils.js';
import { exitLikeCommandResult } from '../shared/cli-utils.js';
import { normalizeDependabot } from '../../src/integrations/triage/normalize/dependabot.js';
import { normalizeAwsInspector } from '../../src/integrations/triage/normalize/aws-inspector.js';
import { normalizeGeneric } from '../../src/integrations/triage/normalize/generic.js';
import { renderRecordMarkdown } from '../../src/integrations/triage/render.js';
import { parseMetaArgs } from '../shared/input-parsers.js';
import { resolveRecordArtifactPathSafe } from './context-pack-paths.js';

const argv = createCli({
  scriptName: 'triage-ingest',
  options: {
    'build-index': { type: 'boolean', default: false },
    incremental: { type: 'boolean', default: false },
    'stub-embeddings': { type: 'boolean', default: false },
    strict: { type: 'boolean', default: false },
    repo: { type: 'string' },
    source: { type: 'string' },
    in: { type: 'string' },
    meta: { type: 'string', array: true }
  },
  aliases: { i: 'in' }
}).parse();

await main().catch((error) => {
  const payload = buildFailurePayload(error);
  console.error(JSON.stringify(payload, null, 2));
  process.exit(error?.exitCode || 1);
});

async function main() {
  const { repoRoot, userConfig } = resolveRepoConfig(argv.repo);
  const source = normalizeSource(argv.source);
  const inputPath = argv.in ? path.resolve(repoRoot, argv.in) : null;

  if (!source || !inputPath) {
    console.error(
      'usage: node tools/triage/ingest.js --source dependabot|aws_inspector|generic --in <file> [--repo <path>] [--meta key=value] [--build-index] [--strict]'
    );
    process.exit(1);
  }

  const runtimeConfig = getRuntimeConfig(repoRoot, userConfig);
  const baseEnv = resolveRuntimeEnv(runtimeConfig, process.env);
  const triageConfig = getTriageConfig(repoRoot, userConfig);
  const meta = parseMetaArgs(argv.meta);

  const normalizer = resolveNormalizer(source);
  if (!normalizer) {
    console.error(`Unsupported source: ${source}`);
    process.exit(1);
  }

  const { entries: rawEntries, audit } = await loadInputEntries(inputPath, {
    strict: argv.strict === true
  });
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
    errorDetails: [],
    ingestAudit: audit
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
      const jsonPath = resolveRecordArtifactPathSafe(triageConfig.recordsDir, record.recordId, '.json');
      const mdPath = resolveRecordArtifactPathSafe(triageConfig.recordsDir, record.recordId, '.md');
      if (!jsonPath || !mdPath) {
        throw new Error(`Invalid recordId path: ${record.recordId}`);
      }
      await fsPromises.writeFile(jsonPath, JSON.stringify(record, null, 2));
      await fsPromises.writeFile(mdPath, renderRecordMarkdown(record));
      results.recordIds.push(record.recordId);
      results.records.push({
        recordId: record.recordId,
        jsonPath,
        mdPath,
        idProvenance: record.idProvenance || null
      });
      results.written += 1;
    } catch (err) {
      results.errors += 1;
      results.errorDetails.push({
        index,
        message: err?.message || String(err)
      });
    }
  }

  results.ingestAudit = finalizeIngestAudit(results.ingestAudit, results.records);

  if (argv['build-index']) {
    const scriptRoot = resolveToolRoot();
    const args = [path.join(scriptRoot, 'build_index.js'), '--mode', 'records', '--repo', repoRoot];
    if (argv.incremental) args.push('--incremental');
    if (argv['stub-embeddings']) args.push('--stub-embeddings');
    const env = { ...baseEnv };
    if (argv['stub-embeddings']) env.PAIROFCLEATS_EMBEDDINGS = 'stub';
    const result = spawnSubprocessSync(process.execPath, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      env,
      rejectOnNonZeroExit: false
    });
    if (result.exitCode !== 0) {
      exitLikeCommandResult({ status: result.exitCode, signal: result.signal });
    }
  }

  console.log(JSON.stringify(results, null, 2));
}

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

/**
 * Load triage entries from JSON or JSONL inputs.
 *
 * Supports top-level arrays, common wrapper keys (`alerts`, `findings`,
 * `records`, `items`), and a fallback to the first array value found in an
 * object payload. If JSON parsing fails, the payload is treated as JSONL.
 *
 * @param {string} filePath
 * @param {{strict?:boolean}} [options]
 * @returns {Promise<{entries:object[],audit:object}>}
 */
async function loadInputEntries(filePath, options = {}) {
  const strict = options.strict === true;
  const rawText = await fsPromises.readFile(filePath, 'utf8');
  const trimmed = rawText.trim();
  if (!trimmed) {
    return {
      entries: [],
      audit: createIngestAudit({ policy: strict ? 'strict' : 'permissive', inputFormat: 'json' })
    };
  }
  try {
    const parsed = JSON.parse(trimmed);
    const entries = coerceJsonEntries(parsed);
    return {
      entries,
      audit: finalizeParsedAudit(
        createIngestAudit({ policy: strict ? 'strict' : 'permissive', inputFormat: 'json' }),
        entries.length
      )
    };
  } catch {
    return parseJsonLines(trimmed, { strict });
  }
}

function coerceJsonEntries(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.alerts)) return parsed.alerts;
  if (Array.isArray(parsed.findings)) return parsed.findings;
  if (Array.isArray(parsed.records)) return parsed.records;
  if (Array.isArray(parsed.items)) return parsed.items;
  if (parsed && typeof parsed === 'object') {
    const firstArray = Object.values(parsed).find((value) => Array.isArray(value));
    if (Array.isArray(firstArray)) return firstArray;
  }
  return [parsed];
}

function parseJsonLines(rawText, options = {}) {
  const strict = options.strict === true;
  const audit = createIngestAudit({
    policy: strict ? 'strict' : 'permissive',
    inputFormat: 'jsonl'
  });
  const lines = rawText.split(/\r?\n/);
  const output = [];
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (!line) continue;
    audit.totalRecordsSeen += 1;
    try {
      output.push(JSON.parse(line));
      audit.parsedRecords += 1;
    } catch (error) {
      audit.malformedRecords += 1;
      audit.skippedRecords += 1;
      audit.malformedLineDiagnostics.push({
        lineNumber: index + 1,
        message: error?.message || String(error),
        sample: line.slice(0, 200)
      });
    }
  }
  if (strict && audit.malformedRecords > 0) {
    const error = new Error('Strict ingest rejected malformed JSONL input.');
    error.code = 'ERR_TRIAGE_INGEST_STRICT_INPUT';
    error.exitCode = 1;
    error.ingestAudit = finalizeIngestAudit(audit, []);
    throw error;
  }
  return {
    entries: output,
    audit: finalizeIngestAudit(audit, [])
  };
}

function createIngestAudit({ policy, inputFormat }) {
  return {
    policy,
    inputFormat,
    totalRecordsSeen: 0,
    parsedRecords: 0,
    malformedRecords: 0,
    skippedRecords: 0,
    malformedLineDiagnostics: [],
    stableIdCount: 0,
    fallbackIdCount: 0,
    idStability: 'stable'
  };
}

function finalizeParsedAudit(audit, totalRecordsSeen) {
  return {
    ...audit,
    totalRecordsSeen,
    parsedRecords: totalRecordsSeen
  };
}

function finalizeIngestAudit(audit, records) {
  const nextAudit = {
    ...audit,
    malformedLineDiagnostics: Array.isArray(audit?.malformedLineDiagnostics)
      ? audit.malformedLineDiagnostics
      : []
  };
  let stableIdCount = 0;
  let fallbackIdCount = 0;
  for (const entry of Array.isArray(records) ? records : []) {
    if (entry?.idProvenance?.method === 'fallback-hash') {
      fallbackIdCount += 1;
    } else if (entry?.idProvenance?.method === 'stable-key') {
      stableIdCount += 1;
    }
  }
  nextAudit.stableIdCount = stableIdCount;
  nextAudit.fallbackIdCount = fallbackIdCount;
  nextAudit.idStability = fallbackIdCount > 0
    ? (stableIdCount > 0 ? 'mixed-lower-trust' : 'fallback-only-lower-trust')
    : 'stable';
  return nextAudit;
}

function buildFailurePayload(error) {
  return {
    ok: false,
    code: error?.code || 'ERR_TRIAGE_INGEST',
    message: error?.message || String(error),
    ingestAudit: error?.ingestAudit || null
  };
}
