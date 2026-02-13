#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import yargs from 'yargs/yargs';
import { ERROR_CODES } from '../src/shared/error-codes.js';
import { resolveRepoConfig } from './shared/dict-utils.js';
import {
  computeIndexDiff,
  listDiffs,
  pruneDiffs,
  showDiff
} from '../src/index/diffs/compute.js';

const emitJson = (payload) => {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
};

const emitError = (err, asJson) => {
  const code = err?.code || ERROR_CODES.INTERNAL;
  const message = err?.message || String(err);
  if (asJson) {
    emitJson({ ok: false, code, message });
  } else {
    process.stderr.write(`${message}\n`);
  }
};

const normalizeBoolean = (value, fallback = false) => {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes'].includes(normalized)) return true;
  if (['0', 'false', 'no'].includes(normalized)) return false;
  return fallback;
};

const DEFAULT_DIFF_RETENTION = Object.freeze({
  keep: 50,
  maxAgeDays: 30
});

const DEFAULT_DIFF_COMPUTE = Object.freeze({
  modes: ['code'],
  detectRenames: true,
  includeRelations: true,
  maxChangedFiles: 200,
  maxChunksPerFile: 500,
  maxEvents: 20000,
  maxBytes: 2 * 1024 * 1024,
  persist: true
});

const normalizeNumber = (value, fallback, minimum = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(minimum, Math.floor(num));
};

const normalizeModes = (value, fallback = DEFAULT_DIFF_COMPUTE.modes) => {
  const raw = Array.isArray(value)
    ? value
    : String(value || '')
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean);
  const selected = raw.length ? raw : fallback;
  const deduped = [];
  for (const mode of selected) {
    const normalized = String(mode || '').trim().toLowerCase();
    if (!normalized || deduped.includes(normalized)) continue;
    deduped.push(normalized);
  }
  return deduped.length ? deduped : [...DEFAULT_DIFF_COMPUTE.modes];
};

const resolveDiffDefaults = (userConfig) => {
  const diffs = (
    userConfig
    && userConfig.indexing
    && typeof userConfig.indexing === 'object'
    && !Array.isArray(userConfig.indexing)
    && userConfig.indexing.diffs
    && typeof userConfig.indexing.diffs === 'object'
    && !Array.isArray(userConfig.indexing.diffs)
  )
    ? userConfig.indexing.diffs
    : null;
  if (!diffs) {
    return {
      keep: DEFAULT_DIFF_RETENTION.keep,
      maxAgeDays: DEFAULT_DIFF_RETENTION.maxAgeDays,
      compute: { ...DEFAULT_DIFF_COMPUTE, modes: [...DEFAULT_DIFF_COMPUTE.modes] }
    };
  }
  const compute = (
    diffs.compute
    && typeof diffs.compute === 'object'
    && !Array.isArray(diffs.compute)
  )
    ? diffs.compute
    : {};
  return {
    keep: normalizeNumber(
      diffs.keep ?? diffs.maxDiffs,
      DEFAULT_DIFF_RETENTION.keep
    ),
    maxAgeDays: normalizeNumber(
      diffs.maxAgeDays ?? diffs.retainDays,
      DEFAULT_DIFF_RETENTION.maxAgeDays
    ),
    compute: {
      modes: normalizeModes(compute.modes),
      detectRenames: normalizeBoolean(compute.detectRenames, DEFAULT_DIFF_COMPUTE.detectRenames),
      includeRelations: normalizeBoolean(
        compute.includeRelations,
        DEFAULT_DIFF_COMPUTE.includeRelations
      ),
      maxChangedFiles: normalizeNumber(
        compute.maxChangedFiles,
        DEFAULT_DIFF_COMPUTE.maxChangedFiles,
        1
      ),
      maxChunksPerFile: normalizeNumber(
        compute.maxChunksPerFile,
        DEFAULT_DIFF_COMPUTE.maxChunksPerFile,
        1
      ),
      maxEvents: normalizeNumber(
        compute.maxEvents ?? diffs.maxEvents,
        DEFAULT_DIFF_COMPUTE.maxEvents,
        1
      ),
      maxBytes: normalizeNumber(
        compute.maxBytes ?? diffs.maxBytes,
        DEFAULT_DIFF_COMPUTE.maxBytes,
        1
      ),
      persist: normalizeBoolean(
        compute.persist ?? compute.persistEvents,
        DEFAULT_DIFF_COMPUTE.persist
      )
    }
  };
};

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
          detectRenames: normalizeBoolean(
            argv['detect-renames'],
            diffDefaults.compute.detectRenames
          ),
          includeRelations: normalizeBoolean(
            argv['include-relations'],
            diffDefaults.compute.includeRelations
          ),
          allowMismatch: normalizeBoolean(argv['allow-mismatch'], false),
          maxChangedFiles: argv['max-changed-files'] ?? diffDefaults.compute.maxChangedFiles,
          maxChunksPerFile: argv['max-chunks-per-file'] ?? diffDefaults.compute.maxChunksPerFile,
          maxEvents: argv['max-events'] ?? diffDefaults.compute.maxEvents,
          maxBytes: argv['max-bytes'] ?? diffDefaults.compute.maxBytes,
          persist: normalizeBoolean(argv.persist, diffDefaults.compute.persist),
          persistUnsafe: normalizeBoolean(argv['persist-unsafe'], false),
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
        emitError(err, argv.json === true);
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
        emitError(err, argv.json === true);
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
        emitError(err, argv.json === true);
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
        emitError(err, argv.json === true);
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
        emitError(err, argv.json === true);
        process.exitCode = 1;
      }
    }
  );

  await parser.demandCommand(0).parseAsync();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runDiffCli().catch((err) => {
    emitError(err, false);
    process.exit(1);
  });
}
