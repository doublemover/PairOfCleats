#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSubprocessSync } from '../../src/shared/subprocess.js';
import {
  resolveCargoCommandInvocation,
  resolveCargoManifestPath,
  toPosixRelative
} from './targets.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtureRoot = path.join(root, 'tests', 'tui', 'fixtures');

const parseArgs = (argv) => {
  const fixtures = [];
  let outDir = path.join(root, '.testLogs', 'tui', 'frame-capture');
  let listOnly = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || '');
    if (arg === '--fixture') {
      fixtures.push(path.resolve(root, String(argv[i + 1] || '')));
      i += 1;
      continue;
    }
    if (arg === '--out-dir') {
      outDir = path.resolve(root, String(argv[i + 1] || ''));
      i += 1;
      continue;
    }
    if (arg === '--list') {
      listOnly = true;
      continue;
    }
    throw new Error(`unknown arg: ${arg}`);
  }
  return {
    fixtures,
    outDir,
    listOnly
  };
};

const listFixtures = async () => {
  const entries = await fsPromises.readdir(fixtureRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(fixtureRoot, entry.name))
    .sort((a, b) => a.localeCompare(b));
};

const main = async () => {
  const { fixtures, outDir, listOnly } = parseArgs(process.argv.slice(2));
  const resolvedFixtures = fixtures.length > 0 ? fixtures : await listFixtures();
  if (listOnly) {
    for (const fixture of resolvedFixtures) {
      process.stdout.write(`${toPosixRelative(root, fixture)}\n`);
    }
    return;
  }
  await fsPromises.mkdir(outDir, { recursive: true });
  const cargoManifestPath = resolveCargoManifestPath(root);
  const cargoInvocation = resolveCargoCommandInvocation(process.env);
  for (const fixturePath of resolvedFixtures) {
    if (!fs.existsSync(fixturePath)) {
      throw new Error(`missing TUI fixture: ${toPosixRelative(root, fixturePath)}`);
    }
    const result = spawnSubprocessSync(
      cargoInvocation.command,
      [
        ...cargoInvocation.args,
        'run',
        '--quiet',
        '--manifest-path',
        cargoManifestPath
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          PAIROFCLEATS_TUI_CAPTURE_FIXTURE: fixturePath,
          PAIROFCLEATS_TUI_CAPTURE_OUT_DIR: outDir
        },
        stdio: 'inherit',
        rejectOnNonZeroExit: false
      }
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `TUI fixture capture failed for ${toPosixRelative(root, fixturePath)} (exit=${result.exitCode ?? 'unknown'})`
      );
    }
  }
  process.stdout.write(
    `captured ${resolvedFixtures.length} fixture(s) to ${toPosixRelative(root, outDir)}\n`
  );
};

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
