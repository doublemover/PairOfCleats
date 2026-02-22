#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import yargs from 'yargs/yargs';
import { createError, ERROR_CODES } from '../src/shared/error-codes.js';
import { resolveRepoConfig } from './shared/dict-utils.js';
import { emitJson } from './shared/cli-utils.js';
import {
  emitCliError,
  parseCommaString,
  resolveSnapshotDefaults
} from './shared/index-cli-utils.js';
import {
  createPointerSnapshot,
  listSnapshots,
  pruneSnapshots,
  removeSnapshot,
  showSnapshot
} from '../src/index/snapshots/create.js';
import { freezeSnapshot, gcSnapshots } from '../src/index/snapshots/freeze.js';

const parseTags = (value, repeated = []) => {
  const csv = parseCommaString(value);
  const all = [...csv, ...repeated.map((tag) => String(tag || '').trim()).filter(Boolean)];
  return all;
};

export async function runSnapshotCli(rawArgs = process.argv.slice(2)) {
  const parser = yargs(rawArgs)
    .scriptName('index-snapshot')
    .parserConfiguration({
      'camel-case-expansion': false,
      'dot-notation': false
    })
    .help()
    .alias('h', 'help')
    .strict(false);

  parser.command(
    'create',
    'Create a pointer snapshot from the current validated build',
    (command) => command
      .option('repo', { type: 'string' })
      .option('modes', { type: 'string' })
      .option('id', { type: 'string' })
      .option('label', { type: 'string' })
      .option('tags', { type: 'string' })
      .option('tag', { type: 'array', string: true })
      .option('wait-ms', { type: 'number', default: 0 })
      .option('max-pointer-snapshots', { type: 'number' })
      .option('json', { type: 'boolean', default: false }),
    async (argv) => {
      try {
        const { repoRoot, userConfig } = resolveRepoConfig(argv.repo);
        const snapshotDefaults = resolveSnapshotDefaults(userConfig);
        const result = await createPointerSnapshot({
          repoRoot,
          userConfig,
          modes: argv.modes,
          tags: parseTags(argv.tags, argv.tag),
          label: argv.label,
          snapshotId: argv.id,
          waitMs: argv['wait-ms'],
          maxPointerSnapshots: argv['max-pointer-snapshots'] ?? snapshotDefaults.keepPointer
        });
        if (argv.json) {
          emitJson({ ok: true, snapshot: result });
        } else {
          process.stderr.write(
            `Created snapshot ${result.snapshotId} (${result.modes.join(', ')})\n`
          );
        }
      } catch (err) {
        emitCliError(err, argv.json === true);
        process.exitCode = 1;
      }
    }
  );

  parser.command(
    'freeze <snapshotId>',
    'Freeze a pointer snapshot into immutable frozen roots',
    (command) => command
      .positional('snapshotId', { type: 'string', demandOption: true })
      .option('repo', { type: 'string' })
      .option('modes', { type: 'string' })
      .option('method', { type: 'string', default: 'hardlink' })
      .option('verify', { type: 'boolean', default: true })
      .option('include-sqlite', { type: 'string', default: 'auto' })
      .option('include-lmdb', { type: 'boolean', default: false })
      .option('wait-ms', { type: 'number', default: 0 })
      .option('json', { type: 'boolean', default: false }),
    async (argv) => {
      try {
        const { repoRoot, userConfig } = resolveRepoConfig(argv.repo);
        const result = await freezeSnapshot({
          repoRoot,
          userConfig,
          snapshotId: argv.snapshotId,
          modes: argv.modes,
          method: argv.method,
          verify: argv.verify !== false,
          includeSqlite: argv['include-sqlite'],
          includeLmdb: argv['include-lmdb'] === true,
          waitMs: argv['wait-ms']
        });
        if (argv.json) {
          emitJson({ ok: true, freeze: result });
        } else if (result.alreadyFrozen) {
          process.stderr.write(`Snapshot ${result.snapshotId} already frozen\n`);
        } else {
          process.stderr.write(
            `Frozen snapshot ${result.snapshotId} (${result.modes.join(', ')})\n`
          );
        }
      } catch (err) {
        emitCliError(err, argv.json === true);
        process.exitCode = 1;
      }
    }
  );

  parser.command(
    'gc',
    'Garbage-collect old snapshots with protected-tag safety',
    (command) => command
      .option('repo', { type: 'string' })
      .option('keep-pointer', { type: 'number' })
      .option('keep-frozen', { type: 'number' })
      .option('keep-tags', { type: 'string' })
      .option('max-age-days', { type: 'number' })
      .option('staging-max-age-hours', { type: 'number' })
      .option('wait-ms', { type: 'number', default: 0 })
      .option('dry-run', { type: 'boolean', default: false })
      .option('json', { type: 'boolean', default: false }),
    async (argv) => {
      try {
        const { repoRoot, userConfig } = resolveRepoConfig(argv.repo);
        const snapshotDefaults = resolveSnapshotDefaults(userConfig);
        const result = await gcSnapshots({
          repoRoot,
          userConfig,
          keepPointer: argv['keep-pointer'] ?? snapshotDefaults.keepPointer,
          keepFrozen: argv['keep-frozen'] ?? snapshotDefaults.keepFrozen,
          keepTags: argv['keep-tags'] ?? snapshotDefaults.protectedTagGlobs.join(','),
          maxAgeDays: argv['max-age-days'] ?? snapshotDefaults.maxAgeDays,
          stagingMaxAgeHours: (
            argv['staging-max-age-hours'] ?? snapshotDefaults.stagingMaxAgeHours
          ),
          waitMs: argv['wait-ms'],
          dryRun: argv['dry-run'] === true
        });
        if (argv.json) {
          emitJson({ ok: true, gc: result });
        } else {
          const prefix = result.dryRun ? '[dry-run] ' : '';
          process.stderr.write(`${prefix}GC removed ${result.removed.length} snapshot(s)\n`);
        }
      } catch (err) {
        emitCliError(err, argv.json === true);
        process.exitCode = 1;
      }
    }
  );

  parser.command(
    'prune',
    'Prune old untagged pointer snapshots',
    (command) => command
      .option('repo', { type: 'string' })
      .option('max-pointer-snapshots', { type: 'number' })
      .option('wait-ms', { type: 'number', default: 0 })
      .option('dry-run', { type: 'boolean', default: false })
      .option('json', { type: 'boolean', default: false }),
    async (argv) => {
      try {
        const { repoRoot, userConfig } = resolveRepoConfig(argv.repo);
        const snapshotDefaults = resolveSnapshotDefaults(userConfig);
        const result = await pruneSnapshots({
          repoRoot,
          userConfig,
          maxPointerSnapshots: argv['max-pointer-snapshots'] ?? snapshotDefaults.keepPointer,
          waitMs: argv['wait-ms'],
          dryRun: argv['dry-run'] === true
        });
        if (argv.json) {
          emitJson({ ok: true, ...result });
        } else {
          const prefix = result.dryRun ? '[dry-run] ' : '';
          process.stderr.write(`${prefix}Pruned ${result.removed.length} snapshot(s)\n`);
        }
      } catch (err) {
        emitCliError(err, argv.json === true);
        process.exitCode = 1;
      }
    }
  );

  parser.command(
    'list',
    'List snapshots',
    (command) => command
      .option('repo', { type: 'string' })
      .option('json', { type: 'boolean', default: false }),
    async (argv) => {
      try {
        const { repoRoot, userConfig } = resolveRepoConfig(argv.repo);
        const snapshots = listSnapshots({ repoRoot, userConfig });
        if (argv.json) {
          emitJson({ ok: true, snapshots });
        } else {
          for (const entry of snapshots) {
            process.stderr.write(
              `${entry.snapshotId} ${entry.kind} ${entry.createdAt} ${entry.tags?.join(',') || ''}\n`
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
    'show <snapshotId>',
    'Show one snapshot',
    (command) => command
      .positional('snapshotId', { type: 'string', demandOption: true })
      .option('repo', { type: 'string' })
      .option('json', { type: 'boolean', default: false }),
    async (argv) => {
      try {
        const { repoRoot, userConfig } = resolveRepoConfig(argv.repo);
        const result = showSnapshot({
          repoRoot,
          userConfig,
          snapshotId: argv.snapshotId
        });
        if (!result) {
          throw createError(ERROR_CODES.NOT_FOUND, `Snapshot not found: ${argv.snapshotId}`);
        }
        if (argv.json) {
          emitJson({ ok: true, ...result });
        } else {
          process.stderr.write(`${result.entry.snapshotId}\n`);
          process.stderr.write(`${JSON.stringify(result.snapshot, null, 2)}\n`);
        }
      } catch (err) {
        emitCliError(err, argv.json === true);
        process.exitCode = 1;
      }
    }
  );

  parser.command(
    ['rm <snapshotId>', 'remove <snapshotId>'],
    'Remove a snapshot',
    (command) => command
      .positional('snapshotId', { type: 'string', demandOption: true })
      .option('repo', { type: 'string' })
      .option('force', { type: 'boolean', default: false })
      .option('wait-ms', { type: 'number', default: 0 })
      .option('json', { type: 'boolean', default: false }),
    async (argv) => {
      try {
        const { repoRoot, userConfig } = resolveRepoConfig(argv.repo);
        const result = await removeSnapshot({
          repoRoot,
          userConfig,
          snapshotId: argv.snapshotId,
          force: argv.force === true,
          waitMs: argv['wait-ms']
        });
        if (argv.json) {
          emitJson({ ok: true, ...result });
        } else {
          process.stderr.write(`Removed snapshot ${result.removed}\n`);
        }
      } catch (err) {
        emitCliError(err, argv.json === true);
        process.exitCode = 1;
      }
    }
  );

  await parser.demandCommand(1).parseAsync();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSnapshotCli().catch((err) => {
    emitCliError(err, false);
    process.exit(1);
  });
}
