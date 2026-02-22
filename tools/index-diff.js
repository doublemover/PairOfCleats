#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import yargs from 'yargs/yargs';
import { resolveRepoConfig } from './shared/dict-utils.js';
import { emitJson } from './shared/cli-utils.js';
import {
  emitCliError,
  resolveDiffDefaults
} from './shared/index-cli-utils.js';
import {
  BOOLEAN_FALSE_TOKENS_NO_OFF,
  BOOLEAN_TRUE_TOKENS_NO_ON,
  normalizeBooleanString
} from '../src/shared/boolean-normalization.js';
import {
  computeIndexDiff,
  listDiffs,
  pruneDiffs,
  showDiff
} from '../src/index/diffs/compute.js';

const buildExplainPayload = ({ diffId, summary, events }) => {
  const byFile = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    const file = event?.file || event?.afterFile || event?.beforeFile;
    if (!file || String(event?.kind || '').startsWith('limits.')) continue;
    const entry = byFile.get(file) || {
      file,
      total: 0,
      fileEvents: 0,
      chunkEvents: 0,
      relationEvents: 0
    };
    entry.total += 1;
    const kind = String(event.kind || '');
    if (kind.startsWith('file.')) entry.fileEvents += 1;
    if (kind.startsWith('chunk.')) entry.chunkEvents += 1;
    if (kind.startsWith('relation.')) entry.relationEvents += 1;
    byFile.set(file, entry);
  }
  const topChangedFiles = Array.from(byFile.values())
    .sort((left, right) => (
      right.total - left.total
      || left.file.localeCompare(right.file)
    ))
    .slice(0, 10);
  return {
    diffId,
    summary,
    topChangedFiles
  };
};

const normalizeDiffBooleanFlag = (value, fallback = false) => (
  normalizeBooleanString(value, {
    fallback,
    trueTokens: BOOLEAN_TRUE_TOKENS_NO_ON,
    falseTokens: BOOLEAN_FALSE_TOKENS_NO_OFF
  })
);

export async function runDiffCli(rawArgs = process.argv.slice(2)) {
  const parser = yargs(rawArgs)
    .scriptName('index-diff')
    .parserConfiguration({
      'camel-case-expansion': false,
      'dot-notation': false
    })
    .help()
    .alias('h', 'help')
    .strict(false);

  parser.command(
    ['compute', '$0'],
    'Compute a deterministic diff between two index refs',
    (command) => command
      .option('repo', { type: 'string' })
      .option('from', { type: 'string', demandOption: true })
      .option('to', { type: 'string', demandOption: true })
      .option('modes', { type: 'string' })
      .option('detect-renames', { type: 'boolean' })
      .option('include-relations', { type: 'boolean' })
      .option('allow-mismatch', { type: 'boolean', default: false })
      .option('max-changed-files', { type: 'number' })
      .option('max-chunks-per-file', { type: 'number' })
      .option('max-events', { type: 'number' })
      .option('max-bytes', { type: 'number' })
      .option('persist', { type: 'boolean' })
      .option('persist-unsafe', { type: 'boolean', default: false })
      .option('wait-ms', { type: 'number', default: 0 })
      .option('dry-run', { type: 'boolean', default: false })
      .option('json', { type: 'boolean', default: false }),
    async (argv) => {
      try {
        const { repoRoot, userConfig } = resolveRepoConfig(argv.repo);
        const diffDefaults = resolveDiffDefaults(userConfig);
        const result = await computeIndexDiff({
          repoRoot,
          userConfig,
          from: argv.from,
          to: argv.to,
          modes: argv.modes ?? diffDefaults.compute.modes.join(','),
          detectRenames: normalizeDiffBooleanFlag(
            argv['detect-renames'],
            diffDefaults.compute.detectRenames
          ),
          includeRelations: normalizeDiffBooleanFlag(
            argv['include-relations'],
            diffDefaults.compute.includeRelations
          ),
          allowMismatch: normalizeDiffBooleanFlag(argv['allow-mismatch'], false),
          maxChangedFiles: argv['max-changed-files'] ?? diffDefaults.compute.maxChangedFiles,
          maxChunksPerFile: argv['max-chunks-per-file'] ?? diffDefaults.compute.maxChunksPerFile,
          maxEvents: argv['max-events'] ?? diffDefaults.compute.maxEvents,
          maxBytes: argv['max-bytes'] ?? diffDefaults.compute.maxBytes,
          persist: normalizeDiffBooleanFlag(argv.persist, diffDefaults.compute.persist),
          persistUnsafe: normalizeDiffBooleanFlag(argv['persist-unsafe'], false),
          waitMs: argv['wait-ms'],
          dryRun: argv['dry-run'] === true
        });
        if (argv.json) {
          emitJson({ ok: true, diff: result });
        } else {
          const persisted = result.persisted ? 'persisted' : 'ephemeral';
          process.stderr.write(
            `Computed diff ${result.diffId} (${persisted}, truncated=${result.summary?.truncated === true})\n`
          );
        }
      } catch (err) {
        emitCliError(err, argv.json === true);
        process.exitCode = 1;
      }
    }
  );

  parser.command(
    'list',
    'List persisted diffs',
    (command) => command
      .option('repo', { type: 'string' })
      .option('modes', { type: 'string' })
      .option('json', { type: 'boolean', default: false }),
    async (argv) => {
      try {
        const { repoRoot, userConfig } = resolveRepoConfig(argv.repo);
        const diffs = listDiffs({
          repoRoot,
          userConfig,
          modes: argv.modes || []
        });
        if (argv.json) {
          emitJson({ ok: true, diffs });
        } else {
          for (const entry of diffs) {
            process.stderr.write(`${entry.id} ${entry.createdAt} ${entry.modes?.join(',') || ''}\n`);
          }
        }
      } catch (err) {
        emitCliError(err, argv.json === true);
        process.exitCode = 1;
      }
    }
  );

  parser.command(
    'show <diffId>',
    'Show one diff summary or JSONL events',
    (command) => command
      .positional('diffId', { type: 'string', demandOption: true })
      .option('repo', { type: 'string' })
      .option('format', { type: 'string', default: 'summary' })
      .option('json', { type: 'boolean', default: false }),
    async (argv) => {
      try {
        const { repoRoot, userConfig } = resolveRepoConfig(argv.repo);
        const format = String(argv.format || 'summary').trim().toLowerCase();
        const result = showDiff({
          repoRoot,
          userConfig,
          diffId: argv.diffId,
          format
        });
        if (!result) {
          throw new Error(`Diff not found: ${argv.diffId}`);
        }
        if (argv.json) {
          emitJson({ ok: true, ...result });
        } else if (format === 'jsonl') {
          for (const event of result.events || []) {
            process.stdout.write(`${JSON.stringify(event)}\n`);
          }
        } else {
          process.stderr.write(`${JSON.stringify(result.summary, null, 2)}\n`);
        }
      } catch (err) {
        emitCliError(err, argv.json === true);
        process.exitCode = 1;
      }
    }
  );

  parser.command(
    'explain <diffId>',
    'Explain one diff with a compact human summary and top changed files',
    (command) => command
      .positional('diffId', { type: 'string', demandOption: true })
      .option('repo', { type: 'string' })
      .option('json', { type: 'boolean', default: false }),
    async (argv) => {
      try {
        const { repoRoot, userConfig } = resolveRepoConfig(argv.repo);
        const result = showDiff({
          repoRoot,
          userConfig,
          diffId: argv.diffId,
          format: 'jsonl'
        });
        if (!result) {
          throw new Error(`Diff not found: ${argv.diffId}`);
        }
        const explainPayload = buildExplainPayload({
          diffId: argv.diffId,
          summary: result.summary,
          events: result.events || []
        });
        if (argv.json) {
          emitJson({ ok: true, ...explainPayload });
        } else {
          process.stderr.write(`Diff ${argv.diffId}\n`);
          process.stderr.write(
            `From ${result.summary?.from?.ref || 'unknown'} -> ${result.summary?.to?.ref || 'unknown'}\n`
          );
          process.stderr.write(
            `Modes: ${(result.summary?.modes || []).join(', ')} | emitted=${result.summary?.totals?.emittedEvents || 0} | truncated=${result.summary?.truncated === true}\n`
          );
          for (const fileEntry of explainPayload.topChangedFiles) {
            process.stderr.write(
              `  ${fileEntry.file} total=${fileEntry.total} file=${fileEntry.fileEvents} chunk=${fileEntry.chunkEvents} relation=${fileEntry.relationEvents}\n`
            );
          }
        }
      } catch (err) {
        emitCliError(err, argv.json === true);
        process.exitCode = 1;
      }
    }
  );

  parser.command(
    'prune',
    'Prune persisted diffs by retention policy',
    (command) => command
      .option('repo', { type: 'string' })
      .option('max-diffs', { type: 'number' })
      .option('retain-days', { type: 'number' })
      .option('wait-ms', { type: 'number', default: 0 })
      .option('dry-run', { type: 'boolean', default: false })
      .option('json', { type: 'boolean', default: false }),
    async (argv) => {
      try {
        const { repoRoot, userConfig } = resolveRepoConfig(argv.repo);
        const diffDefaults = resolveDiffDefaults(userConfig);
        const result = await pruneDiffs({
          repoRoot,
          userConfig,
          maxDiffs: argv['max-diffs'] ?? diffDefaults.keep,
          retainDays: argv['retain-days'] ?? diffDefaults.maxAgeDays,
          waitMs: argv['wait-ms'],
          dryRun: argv['dry-run'] === true
        });
        if (argv.json) {
          emitJson({ ok: true, ...result });
        } else {
          const prefix = result.dryRun ? '[dry-run] ' : '';
          process.stderr.write(`${prefix}Pruned ${result.removed.length} diff(s)\n`);
        }
      } catch (err) {
        emitCliError(err, argv.json === true);
        process.exitCode = 1;
      }
    }
  );

  await parser.demandCommand(0).parseAsync();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runDiffCli().catch((err) => {
    emitCliError(err, false);
    process.exit(1);
  });
}
