#!/usr/bin/env node
import fs from 'node:fs';
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
import { withOperationalTool } from '../tooling/operational-execution.js';

const argv = createCli({
  scriptName: 'ctags-ingest',
  options: {
    repo: { type: 'string' },
    input: { type: 'string' },
    out: { type: 'string' },
    json: { type: 'boolean', default: false },
    run: { type: 'boolean', default: false },
    interactive: { type: 'boolean', default: false },
    ctags: { type: 'string' },
    fields: { type: 'string' },
    args: { type: 'string' },
    'timeout-ms': { type: 'number' }
  }
}).strictOptions().parse();

const { repoRoot, userConfig } = resolveRepoConfig(argv.repo);
const cacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const outputPath = argv.out
  ? path.resolve(argv.out)
  : path.join(cacheRoot, 'ctags', 'ctags.jsonl');
const metaPath = `${outputPath}.meta.json`;
const inputPath = argv.input ? String(argv.input) : null;
const runCtags = argv.run === true;
const interactive = argv.interactive === true;
const ctagsCmd = argv.ctags || null;
const commandTimeoutMs = normalizeTimeoutMs(argv['timeout-ms']);

const normalizePath = (value) => {
  return normalizeRepoRelativePath(repoRoot, value);
};

const mapEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  if (entry._type && entry._type !== 'tag') return null;
  const name = entry.name || null;
  const file = normalizePath(entry.path || entry.file || entry.input || '');
  if (!name || !file) return null;
  const ext = path.extname(file).toLowerCase();
  const kind = entry.kind || null;
  const kindName = entry.kindName || null;
  const signature = entry.signature || entry.pattern || null;
  const line = Number.isFinite(Number(entry.line)) ? Number(entry.line) : null;
  const startLine = line;
  const endLine = line;
  return {
    file,
    ext,
    name,
    kind,
    kindName,
    signature,
    startLine,
    endLine,
    scope: entry.scope || null,
    scopeKind: entry.scopeKind || null,
    access: entry.access || null,
    implementation: entry.implementation || null,
    language: entry.language || null,
    typeref: entry.typeref || null
  };
};

const stats = {
  entries: 0,
  ignored: 0,
  errors: 0,
  kinds: {},
  languages: {}
};

let writeStream = null;

const handleParsedEntry = async (parsed) => {
  const mapped = mapEntry(parsed);
  if (!mapped) {
    stats.ignored += 1;
    return;
  }
  stats.entries += 1;
  bumpStat(stats.kinds, mapped.kind || mapped.kindName || 'unknown');
  bumpStat(stats.languages, mapped.language || 'unknown');
  await writeJsonLine(writeStream, mapped);
};

const ingestStream = async (stream) => {
  await ingestJsonLineStream(stream, {
    onParseError: () => {
      stats.errors += 1;
    },
    onPayload: handleParsedEntry
  });
};

const runCtagsCommand = async () => {
  const suppliedArgs = argv.args ? splitCliArgs(argv.args) : [];
  const marker = suppliedArgs.indexOf('--');
  const optionArgs = marker < 0 ? suppliedArgs : suppliedArgs.slice(0, marker);
  if (optionArgs.some(token => /^--(?:options|output-format|output-file|append|filter|interactive)(?:=|$)/.test(token)
    || /^-[fo](?:.|$)/.test(token))) throw new Error('Ctags ingest owns JSON/stdout publication and disables ambient options files. Pass parser/selection options only.');
  const args = ['--options=NONE', '--output-format=json', '--tag-relative=yes', '--recurse=yes', '-f', '-'];
  if (argv.fields) args.push(`--fields=${argv.fields}`);
  args.push('--fields=+n', ...suppliedArgs);
  args.push(repoRoot);
  await withOperationalTool('universal-ctags', { repoRoot, commandOverride: ctagsCmd }, tool => tool.stream(runLineStreamingCommand, args, {
    cwd: repoRoot,
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
      await handleParsedEntry(parsed);
    },
    onStderrChunk: (chunk) => process.stderr.write(chunk)
  }));
};

await withStagedIngestOutput(outputPath, async (stream) => {
  writeStream = stream;
  if (interactive) {
    await ingestStream(process.stdin);
  } else if (inputPath && inputPath !== '-') {
    const inputStream = fs.createReadStream(inputPath, { encoding: 'utf8' });
    await ingestStream(inputStream);
  } else if (inputPath === '-' || runCtags) {
    if (runCtags) {
      await runCtagsCommand();
    } else {
      await ingestStream(process.stdin);
    }
  } else {
    await runCtagsCommand();
  }
});

const summary = {
  generatedAt: new Date().toISOString(),
  repoRoot: path.resolve(repoRoot),
  input: inputPath || (runCtags ? 'ctags' : 'stdin'),
  output: path.resolve(outputPath),
  stats
};
await writeIngestSummaryReport(metaPath, summary);

if (argv.json) {
  emitIngestSummaryJson(summary);
} else {
  console.error(`Ctags ingest: ${stats.entries} entries (${stats.errors} parse errors)`);
  console.error(`- output: ${outputPath}`);
  console.error(`- meta: ${metaPath}`);
}
