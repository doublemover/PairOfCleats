#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createCli } from '../src/shared/cli.js';
import { resolveRepoRoot } from './dict-utils.js';

const argv = createCli({
  scriptName: 'git-hooks',
  options: {
    install: { type: 'boolean', default: false },
    uninstall: { type: 'boolean', default: false },
    status: { type: 'boolean', default: false },
    hooks: { type: 'string' },
    repo: { type: 'string' }
  }
}).parse();

const rootArg = argv.repo ? path.resolve(argv.repo) : null;
const root = rootArg || resolveRepoRoot(process.cwd());
const gitDir = path.join(root, '.git');
if (!fsSync.existsSync(gitDir)) {
  console.error('Git repository not found. Run this from a repo with a .git directory.');
  process.exit(1);
}

const hooksDir = path.join(gitDir, 'hooks');
const hookList = (argv.hooks || 'post-commit,post-merge')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

const marker = '# PairOfCleats hook';
const hookBody = `${marker}
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$ROOT" ]; then
  exit 0
fi
node "$ROOT/bin/pairofcleats.js" build-index --incremental --repo "$ROOT"
`;

const ensureHooksDir = async () => {
  await fs.mkdir(hooksDir, { recursive: true });
};

const hookPath = (name) => path.join(hooksDir, name);

const installHooks = async () => {
  await ensureHooksDir();
  for (const hook of hookList) {
    const target = hookPath(hook);
    await fs.writeFile(target, `#!/bin/sh\n${hookBody}`, { mode: 0o755 });
    console.log(`installed: ${target}`);
  }
};

const uninstallHooks = async () => {
  for (const hook of hookList) {
    const target = hookPath(hook);
    if (!fsSync.existsSync(target)) {
      console.log(`missing: ${target}`);
      continue;
    }
    const contents = fsSync.readFileSync(target, 'utf8');
    if (!contents.includes(marker)) {
      console.log(`skip: ${target} (not managed by PairOfCleats)`);
      continue;
    }
    await fs.rm(target, { force: true });
    console.log(`removed: ${target}`);
  }
};

const statusHooks = () => {
  for (const hook of hookList) {
    const target = hookPath(hook);
    if (!fsSync.existsSync(target)) {
      console.log(`missing: ${target}`);
      continue;
    }
    const contents = fsSync.readFileSync(target, 'utf8');
    if (contents.includes(marker)) {
      console.log(`installed: ${target}`);
    } else {
      console.log(`present: ${target} (not managed by PairOfCleats)`);
    }
  }
};

if (argv.install) {
  await installHooks();
} else if (argv.uninstall) {
  await uninstallHooks();
} else {
  await statusHooks();
}
