#!/usr/bin/env node
import yargs from 'yargs/yargs';
import { SNAPSHOT_COMMANDS, configureSnapshotCommand } from '../src/shared/index-tool-options.js';
import { isDirectExecution } from '../src/shared/direct-execution.js';
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

const formatDryRunPrefix = (result) => (result?.dryRun ? '[dry-run] ' : '');

const runSnapshotMaintenanceCommand = async (argv, {
  execute,
  toJson,
  toText
}) => {
  try {
    const { repoRoot, userConfig } = resolveRepoConfig(argv.repo);
    const snapshotDefaults = resolveSnapshotDefaults(userConfig);
    const result = await execute({ repoRoot, userConfig, snapshotDefaults });
    if (argv.json) {
      emitJson(toJson(result));
    } else {
      process.stderr.write(toText(result));
    }
  } catch (err) {
    emitCliError(err, argv.json === true);
    process.exitCode = 1;
  }
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
    SNAPSHOT_COMMANDS.create.command,
    SNAPSHOT_COMMANDS.create.description,
    (command) => configureSnapshotCommand(command, 'create'),
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
          retentionTier: argv['retention-tier'],
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
    SNAPSHOT_COMMANDS.freeze.command,
    SNAPSHOT_COMMANDS.freeze.description,
    (command) => configureSnapshotCommand(command, 'freeze'),
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
          retentionTier: argv['retention-tier'],
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
    SNAPSHOT_COMMANDS.gc.command,
    SNAPSHOT_COMMANDS.gc.description,
    (command) => configureSnapshotCommand(command, 'gc'),
    async (argv) => {
      await runSnapshotMaintenanceCommand(argv, {
        execute: ({ repoRoot, userConfig, snapshotDefaults }) => gcSnapshots({
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
        }),
        toJson: (result) => ({ ok: true, gc: result }),
        toText: (result) => `${formatDryRunPrefix(result)}GC removed ${result.removed.length} snapshot(s)\n`
      });
    }
  );

  parser.command(
    SNAPSHOT_COMMANDS.prune.command,
    SNAPSHOT_COMMANDS.prune.description,
    (command) => configureSnapshotCommand(command, 'prune'),
    async (argv) => {
      await runSnapshotMaintenanceCommand(argv, {
        execute: ({ repoRoot, userConfig, snapshotDefaults }) => pruneSnapshots({
          repoRoot,
          userConfig,
          maxPointerSnapshots: argv['max-pointer-snapshots'] ?? snapshotDefaults.keepPointer,
          waitMs: argv['wait-ms'],
          dryRun: argv['dry-run'] === true
        }),
        toJson: (result) => ({ ok: true, ...result }),
        toText: (result) => `${formatDryRunPrefix(result)}Pruned ${result.removed.length} snapshot(s)\n`
      });
    }
  );

  parser.command(
    SNAPSHOT_COMMANDS.list.command,
    SNAPSHOT_COMMANDS.list.description,
    (command) => configureSnapshotCommand(command, 'list'),
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
    SNAPSHOT_COMMANDS.show.command,
    SNAPSHOT_COMMANDS.show.description,
    (command) => configureSnapshotCommand(command, 'show'),
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
    SNAPSHOT_COMMANDS.remove.command,
    SNAPSHOT_COMMANDS.remove.description,
    (command) => configureSnapshotCommand(command, 'remove'),
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

if (isDirectExecution(import.meta.url)) {
  runSnapshotCli().catch((err) => {
    emitCliError(err, false);
    process.exit(1);
  });
}
