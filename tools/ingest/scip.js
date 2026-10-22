#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { getRepoCacheRoot, resolveRepoConfig } from '../shared/dict-utils.js';
import {
  bumpStat,
  emitIngestSummaryJson,
  withStagedIngestOutput,
  ingestJsonLineStream,
  normalizeRepoRelativePath,
  normalizeTimeoutMs,
  splitCliArgs,
  writeIngestSummaryReport,
  writeJsonLine
} from './shared.js';
import { runLineStreamingCommand } from './shared-runner.js';
import { scipRoleInfo as roleInfo, normalizeScipFlatRange as normalizeRange,
  extractScipSymbolInfo as extractSymbolInfo } from '../../src/index/tooling/scip-format.js';

const argv = createCli({
  scriptName: 'scip-ingest',
  options: {
    repo: { type: 'string' },
    input: { type: 'string' },
    out: { type: 'string' },
    json: { type: 'boolean', default: false },
    run: { type: 'boolean', default: false },
    scip: { type: 'string', default: 'scip' },
    args: { type: 'string' },
    'timeout-ms': { type: 'number' }
  }
}).strictOptions().parse();

const { repoRoot, userConfig } = resolveRepoConfig(argv.repo);
const cacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const outputPath = argv.out
  ? path.resolve(argv.out)
  : path.join(cacheRoot, 'scip', 'scip.jsonl');
const metaPath = `${outputPath}.meta.json`;
const inputPath = argv.input ? String(argv.input) : null;
const runScip = argv.run === true;
const scipCmd = argv.scip || 'scip';
const commandTimeoutMs = normalizeTimeoutMs(argv['timeout-ms']);

const normalizePath = (value) => {
  return normalizeRepoRelativePath(repoRoot, value);
};

const stats = {
  documents: 0,
  occurrences: 0,
  definitions: 0,
  references: 0,
  imports: 0,
  writes: 0,
  reads: 0,
  generated: 0,
  tests: 0,
  forwardDefinitions: 0,
  errors: 0,
  kinds: {},
  languages: {}
};

let writeStream = null;

const writeOccurrence = async (doc, occurrence, symbolInfo) => {
  if (!occurrence || !occurrence.symbol) return;
  const file = normalizePath(doc.relativePath || doc.path || doc.file || '');
  if (!file) return;
  const range = normalizeRange(occurrence.range || occurrence.enclosingRange);
  const info = symbolInfo.get(occurrence.symbol) || {};
  const role = roleInfo(occurrence.symbolRoles);
  const entry = {
    file,
    ext: path.extname(file).toLowerCase(),
    name: info.displayName || info.symbol || occurrence.symbol,
    symbol: occurrence.symbol,
    kind: info.kind || info.symbolKind || null,
    signature: info.signature || info.signatureDocumentation || null,
    startLine: range ? range.startLine : null,
    endLine: range ? range.endLine : null,
    startChar: range ? range.startChar : null,
    endChar: range ? range.endChar : null,
    role: role.isDefinition ? 'definition' : 'reference',
    symbolRoles: role.symbolRoles,
    isImport: role.isImport,
    isWriteAccess: role.isWriteAccess,
    isReadAccess: role.isReadAccess,
    isGenerated: role.isGenerated,
    isTest: role.isTest,
    isForwardDefinition: role.isForwardDefinition,
    language: info.language || doc.language || null,
    scope: info.scope || null,
    scopeKind: info.scopeKind || null
  };
  stats.occurrences += 1;
  if (role.isDefinition) stats.definitions += 1;
  if (role.isReference) stats.references += 1;
  if (role.isImport) stats.imports += 1;
  if (role.isWriteAccess) stats.writes += 1;
  if (role.isReadAccess) stats.reads += 1;
  if (role.isGenerated) stats.generated += 1;
  if (role.isTest) stats.tests += 1;
  if (role.isForwardDefinition) stats.forwardDefinitions += 1;
  bumpStat(stats.kinds, entry.kind || 'unknown');
  bumpStat(stats.languages, entry.language || 'unknown');
  await writeJsonLine(writeStream, entry);
};

const handleDocument = async (doc) => {
  if (!doc || typeof doc !== 'object') return;
  const file = doc.relativePath || doc.path || doc.file || null;
  if (!file) return;
  stats.documents += 1;
  const symbolInfo = extractSymbolInfo(doc);
  const occurrences = Array.isArray(doc.occurrences) ? doc.occurrences : [];
  for (const occ of occurrences) {
    await writeOccurrence(doc, occ, symbolInfo);
  }
};

const handlePayload = async (payload) => {
  if (!payload) return;
  if (Array.isArray(payload)) {
    for (const entry of payload) await handlePayload(entry);
    return;
  }
  if (Array.isArray(payload.documents)) {
    for (const doc of payload.documents) await handleDocument(doc);
    return;
  }
  if (payload.relativePath || payload.path || payload.file) {
    await handleDocument(payload);
  }
};

const ingestJsonLines = async (stream) => {
  await ingestJsonLineStream(stream, {
    onParseError: () => {
      stats.errors += 1;
    },
    onPayload: handlePayload
  });
};

const ingestJsonFile = async (filePath) => {
  try {
    const raw = await fsPromises.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    await handlePayload(parsed);
    return true;
  } catch {
    return false;
  }
};

const runScipCommand = async () => {
  const args = ['print', '--format=json'];
  if (inputPath) args.push('--input', inputPath);
  if (argv.args) {
    args.push(...splitCliArgs(argv.args));
  }
  await runLineStreamingCommand({
    command: scipCmd,
    args,
    timeoutMs: commandTimeoutMs,
    onStdoutLine: async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed = null;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        stats.errors += 1;
        return;
      }
      await handlePayload(parsed);
    },
    onStderrChunk: (chunk) => process.stderr.write(chunk)
  });
};

await withStagedIngestOutput(outputPath, async (stream) => {
  writeStream = stream;
  if (runScip) {
    await runScipCommand();
  } else if (inputPath && inputPath !== '-') {
    const parsed = await ingestJsonFile(inputPath);
    if (!parsed) {
      const inputStream = fs.createReadStream(inputPath, { encoding: 'utf8' });
      await ingestJsonLines(inputStream);
    }
  } else {
    await ingestJsonLines(process.stdin);
  }
});

const summary = {
  generatedAt: new Date().toISOString(),
  repoRoot: path.resolve(repoRoot),
  input: inputPath || (runScip ? 'scip' : 'stdin'),
  output: path.resolve(outputPath),
  stats
};
await writeIngestSummaryReport(metaPath, summary);

if (argv.json) {
  emitIngestSummaryJson(summary);
} else {
  console.error(`SCIP ingest: ${stats.occurrences} occurrences (${stats.errors} parse errors)`);
  console.error(`- output: ${outputPath}`);
  console.error(`- meta: ${metaPath}`);
}
